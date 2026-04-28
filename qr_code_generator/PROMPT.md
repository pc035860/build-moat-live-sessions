# QR Code Generator Prototype

## System Requirements

Build a dynamic QR code system where:
- Users submit a long URL and get back a short URL token + QR code image
- The QR code encodes a short URL that redirects (302) to the original URL via your server
- Users can modify the target URL after QR code creation
- Users can delete a QR code (soft delete)
- Users can optionally set an expiration timestamp on create or update
- Deleted or expired links return appropriate HTTP status codes
- URL validation: format check, normalization, malicious URL blocking

## Design Questions

Answer these before you start coding:

1. **Static vs Dynamic QR Code:** Why does this system use dynamic QR codes (encode short URL) instead of static (encode original URL directly)? When would you choose static instead?

   **My Answer:**
   選擇 dynamic 是因為產出的 URL 長度比較可控。QR code 能呈現的複雜度有限，所以若想在有限的複雜度內 contain 這個 URL，用 dynamic 就可以縮短網址。此外，dynamic 還有一個好處：同樣的 QR code，可以在事後調整導向的位置。

   **Ruru's Additions:**
   - **Analytics 也是 dynamic 的關鍵價值**：流量會經過 server，可以記錄掃描次數、地區、時間。這在行銷場景（餐廳菜單、海報、名片）超重要。
   - **何時選 static**：
     - 離線/無 server 場景：Wi-Fi QR code、vCard 名片
     - 隱私/去中心化考量：不希望使用者掃描行為被追蹤
   - Trade-off 一句話：dynamic 多了 server hop 的延遲，但換來可控性、可分析性、可變更性。

2. **Token Generation:** How will you generate short URL tokens? What happens when two different URLs produce the same token? How does collision probability change as the number of tokens grows?

   **My Answer:**
   原本想用 `MD5(timestamp + url)` 再丟給 NanoID 之類的工具生成固定長度 hash。如果兩個 URL 撞在一起就重跑一次，碰撞機率應該蠻低的，但確切機率怎麼算還不太確定。

   **Ruru's Additions:**
   - **MD5 那層其實是多餘的**：NanoID 本身就用 CSPRNG 生成 URL-safe token，直接 `nanoid(size=8)` 即可，除非需要 idempotent 行為（同 URL 同秒 → 同 token），但 spec 沒這個需求。
   - **碰撞機率（生日悖論）**：用 NanoID 預設字母表（64 chars），公式 `n ≈ √(2 × 64^L × ln(2))`：

     | Token 長度 | 50% 碰撞需要的數量 |
     |-----------|-------------------|
     | 6 | ~24,000 |
     | 8 | ~6.1M |
     | 10 | ~1.5B |
     | 12 | ~400B |

   - **MVP 建議**：`nanoid(size=8)` + DB unique constraint + retry：
     ```python
     for _ in range(3):
         token = nanoid(8)
         try:
             db.insert(token, url)
             return token
         except UniqueViolation:
             continue
     raise CollisionError
     ```

3. **Redirect Strategy:** Why 302 (temporary) instead of 301 (permanent)? What are the trade-offs for analytics, URL modification, and latency?

   **My Answer:**
   既然不是 static，代表網址有機會變換。一旦會變，301 可能會被中介層、CDN、Google 等搜尋引擎 cache 住，導致更新後的網址沒辦法反映出來。trade-off 是 302 吃不到這些 cache，所以速度相對慢一點。

   **Ruru's Additions:**
   - **更慘的是瀏覽器自己也會 cache 301 很久**（Chrome 會 cache 到清除為止），對 dynamic QR 是致命傷。
   - **302 也是 analytics 的前提**：301 被 cache 後直接跳轉，第二次以後的掃描資料完全收不到。所以 302 不只是「可變更」的需求，也是「可分析」的前提。
   - **小知識**：HTTP 還有 `307`（保留 method）和 `308`（permanent + 保留 method），但對 GET 重定向，用 302 最沒爭議。

4. **URL Normalization:** What normalization rules do you need? Why is `http://Example.com/` and `https://example.com` potentially the same URL?

   **My Answer:**
   對 URL spec 不太熟，需要討論補充。

   **Ruru's Additions (主要由瑠瑠提供):**
   - **必做（MVP 級別）**：
     | 規則 | 範例 |
     |------|------|
     | Scheme 小寫 | `HTTP://` → `http://` |
     | Host 小寫 | `Example.COM` → `example.com` |
     | 移除預設 port | `:80` (http), `:443` (https) 拿掉 |
     | 加上 trailing slash 到 root | `http://a.com` → `http://a.com/` |
     | Percent-encoding 大寫 | `%2f` → `%2F` |

   - **可做但慎用（非 MVP）**：移除 fragment（SPA 路由可能依賴）、排序 query params（有些 API 對順序敏感）。
   - **不要做**：移除追蹤參數（`utm_*`）會破壞使用者意圖；強制 `http` → `https` 升級可能 404。
   - **為什麼 `http://Example.com/` ≈ `https://example.com`**：
     - Host 大小寫不敏感（DNS spec）→ 同一台機器
     - 但 scheme 不同理論上是不同 URL（不同 port、不同證書）
     - 多數現代網站自動 301 http → https，**實務上**會視為同一目標
   - **MVP 建議**：只做「scheme/host 小寫 + 移除預設 port」即可，其他是兔子洞。

5. **Error Semantics:** What should happen when someone scans a deleted link vs a non-existent link? Should the HTTP status codes be different?

   **My Answer:**
   原本想簡單一點，全部回 `404 Not Found` 就好，不一定要區分。但 PROMPT 的 verification 段明確要求區分（deleted → 410, non-existent → 404），所以採用區分方案。

   **Ruru's Additions:**
   - **語意對應**：
     | 情況 | Status | 語意 |
     |------|--------|------|
     | Token 從未存在 | `404 Not Found` | 「沒這個東西」 |
     | Token 曾存在但被刪除 | `410 Gone` | 「曾經在，但永久消失了」 |
     | Token 過期 | `410 Gone`（或 `404`） | 「過期了」 |

   - **為什麼區分有價值**：
     1. **使用者體驗**：實體海報上的 QR 被刪除時，410 可給「此活動已結束」的友善頁面；404 則暗示「打錯網址」。
     2. **搜尋引擎行為**：410 會讓 Google 快速從 index 移除，404 會反覆重試。
     3. **Spec 明確要求**：見下方 verification（deleted → 410, non-existent → 404）。

## Verification

Your prototype should pass all of these:

```bash
# Create a QR code
curl -X POST http://localhost:8000/api/qr/create \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com"}'
# → 200, returns {"token": "...", "short_url": "...", "qr_code_url": "...", "original_url": "..."}

# Redirect
curl -o /dev/null -w "%{http_code}" http://localhost:8000/r/{token}
# → 302

# Get info
curl http://localhost:8000/api/qr/{token}
# → 200, returns token metadata

# Update target URL
curl -X PATCH http://localhost:8000/api/qr/{token} \
  -H "Content-Type: application/json" \
  -d '{"url": "https://new-url.com"}'
# → 200

# Redirect now goes to new URL
curl -o /dev/null -w "%{redirect_url}" http://localhost:8000/r/{token}
# → https://new-url.com

# Delete
curl -X DELETE http://localhost:8000/api/qr/{token}
# → 200

# Redirect after delete
curl -o /dev/null -w "%{http_code}" http://localhost:8000/r/{token}
# → 410

# Non-existent token
curl -o /dev/null -w "%{http_code}" http://localhost:8000/r/INVALID
# → 404

# QR code image
# (create a new one first, then)
curl -o /dev/null -w "%{http_code} %{content_type}" http://localhost:8000/api/qr/{token}/image
# → 200 image/png

# Analytics
curl http://localhost:8000/api/qr/{token}/analytics
# → 200, returns {"token": "...", "total_scans": N, "scans_by_day": [...]}
```

## Suggested Tech Stack

Python + FastAPI recommended, but you may use any language/framework.
