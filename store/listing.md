# Chrome Web Store listing — Group Post Dedup

Điền các mục dưới đây vào Developer Dashboard. Trước khi nộp, thay mọi `<...>` bằng thông tin của bạn.

## Package

- Tải lên: `dist/group-post-dedup-1.0.0.zip` (tạo bằng `scripts/package.sh`).
- Ngôn ngữ mặc định: Tiếng Việt.
- Danh mục: Productivity (Năng suất).
- Hiển thị: **Unlisted** nếu chỉ dùng riêng/chia sẻ link; **Public** nếu muốn công khai.

## Tên (≤ 45 ký tự)

Group Post Dedup

## Mô tả ngắn (≤ 132 ký tự, lấy từ manifest)

Thu gọn hoặc ẩn các bài trùng nội dung của cùng một người đăng ở nhiều nhóm trên bảng tin, để bạn không đọc lại.

## Mô tả chi tiết — Tiếng Việt

Bạn tham gia nhiều nhóm mua bán, và một người bán đăng cùng một nội dung vào hàng chục nhóm? Group Post Dedup giúp bạn chỉ đọc một lần.

Extension tự nhận ra các bài có nội dung giống nhau do cùng một người đăng ở nhiều nhóm trên trang facebook.com, giữ lại bài đầu tiên và thu gọn các bản trùng thành một dòng nhỏ có nút "Hiện bài".

Tính năng
• Nhận diện bài trùng theo người đăng và nội dung, kể cả khi bài bị cắt bởi "Xem thêm" hoặc đổi dấu câu.
• Thu gọn (có nút Hiện bài) hoặc ẩn hoàn toàn.
• Chỉnh độ giống tối thiểu và chọn chỉ lọc khi cùng người đăng.
• Nhớ các bài đã thấy trong 24 giờ để lần mở sau vẫn lọc đúng (tùy chọn, tắt được, xóa được bằng một nút).
• Chạy được trên Bảng feed (Mới nhất) và bảng tin thường; xử lý cả cơ chế Facebook tự làm rỗng bài khi cuộn, không gây giật layout.

Quyền riêng tư
• Mọi xử lý diễn ra ngay trong trình duyệt của bạn. Extension không gửi dữ liệu đi đâu, không có máy chủ, không có quảng cáo hay theo dõi.
• Chỉ lưu hash của nội dung bài, không lưu chữ gốc.

Lưu ý
• Extension không liên kết với, không được bảo trợ hay xác nhận bởi Meta Platforms, Inc. Facebook là thương hiệu của Meta.
• Giao diện Facebook thay đổi thường xuyên; nếu có bài không được nhận diện, hãy dùng nút "Chẩn đoán" trong popup và gửi báo cáo cho nhà phát triển.

## Mô tả chi tiết — English

Join many marketplace groups where one seller posts the same item to dozens of them? Group Post Dedup lets you read it once.

The extension detects posts with the same content published by the same person in several groups on facebook.com, keeps the first one and collapses the repeats into a small line with a "Show post" button.

Features
• Matches by author and content, even if a post is truncated by "See more" or differs in punctuation.
• Collapse (with a Show button) or hide completely.
• Adjustable similarity threshold, and an option to match only the same author.
• Optionally remembers seen posts for 24 hours so later visits are filtered consistently (can be turned off or cleared with one click).
• Works on the Feeds (Most recent) page and the regular feed, including Facebook's virtualised posts, without causing layout jumps.

Privacy
• Everything runs inside your browser. No data is sent anywhere; no server, ads or tracking.
• Only hashes of post content are stored, never the original text.

Notes
• Not affiliated with, endorsed or sponsored by Meta Platforms, Inc. Facebook is a trademark of Meta.
• Facebook changes its pages often. If some posts are not detected, use the "Chẩn đoán" button in the popup and send the report to the developer.

## Single purpose (mục "Single purpose")

Hide or collapse duplicate posts (same content from the same author in different groups) on facebook.com.

## Permission justifications

- **Host permission `*://*.facebook.com/*`**: The extension must read the posts on the facebook.com feed (author, group, text) to detect duplicates and must collapse the duplicate posts in the page. It does not run on any other site.
- **`storage`**: Saves the user's settings (`chrome.storage.sync`) and, if enabled, hashed fingerprints of recently seen posts for up to 24 hours (`chrome.storage.local`) so duplicates are recognised across page reloads.
- **Remote code**: No. All code is bundled in the package. No `eval`, no external scripts.

## Data usage disclosure (mục "Privacy practices")

Tick:
- **Website content** (text of posts on facebook.com) — used locally to detect duplicates; hashed fingerprints stored locally.
- **Personally identifiable information**: tick only if the dashboard counts author/group names as PII (they are stored locally for up to 24 hours; recommended: tick it to be safe).

Certify all three statements:
- I do not sell or transfer user data to third parties outside approved use cases.
- I do not use or transfer user data for purposes unrelated to the item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

Privacy policy URL: `<PUBLIC_URL_OF_PRIVACY_POLICY>` (host `store/privacy-policy.html` công khai).

## Hình ảnh

| Mục | File | Kích thước |
|---|---|---|
| Icon cửa hàng | `icons/icon128.png` | 128×128 |
| Ảnh chụp 1 | `store/screenshots/1-feed-collapsed.png` | 1280×800 |
| Ảnh chụp 2 | `store/screenshots/2-popup.png` | 1280×800 |
| Ô quảng cáo nhỏ | `store/screenshots/promo-small.png` | 440×280 |

Các ảnh dùng dữ liệu giả (tên người và nhóm hư cấu), không chứa nội dung từ tài khoản Facebook thật.

## Trước khi nộp

1. Thay `YOUR_CONTACT_EMAIL` (2 chỗ) trong `store/privacy-policy.html` bằng email liên hệ của bạn, rồi host file này công khai (GitHub Pages hoặc hosting bất kỳ) để có URL cho mục Privacy policy.
2. Trong Dashboard: tab Account, xác minh email liên hệ.
3. Chuẩn bị trả lời nếu bị hỏi về việc dùng chữ "Facebook" (chỉ mô tả trang mà extension hoạt động, kèm tuyên bố không liên kết với Meta).
