# Group Post Dedup

Chrome extension (Manifest V3), không liên kết với Meta/Facebook. Thu gọn/ẩn các bài viết trùng nội dung của cùng một người đăng ở nhiều nhóm trên Facebook feed (kể cả `https://web.facebook.com/?filter=all&sk=h_chr`).

## Cài đặt

1. Mở `chrome://extensions`, bật **Developer mode**.
2. **Load unpacked** → chọn thư mục này.
3. Mở/reload trang Facebook. Bài đầu tiên (trên cùng feed) được giữ; các bài sau trùng nội dung sẽ bị thu gọn kèm nút **Hiện bài**.

## Tuỳ chọn (click icon extension)

- Bật/tắt lọc.
- Chỉ coi là trùng khi cùng người đăng (mặc định bật).
- Thu gọn (có nút Hiện bài) hoặc ẩn hoàn toàn.
- Độ giống tối thiểu (mặc định 85%).
- Hiện nút **Chặn** nhanh ở mỗi comment (mặc định bật).

## Cách hoạt động

- Mỗi bài top-level (`[role="article"]`, bỏ qua comment) được trích xuất: tác giả, nhóm, post id, nội dung.
- Nội dung được chuẩn hoá (bỏ dấu, link, ký tự đặc biệt) rồi so bằng overlap của các cụm 3 từ, nên bản bị cắt "Xem thêm" vẫn khớp.
- Bài render lại bởi Facebook (cùng post id) không bị tính là trùng với chính nó.
- Hỗ trợ cả trang Feeds (`sk=h_chr`, không có `role="article"`, mỗi bài là một `div[data-virtualized]`) lẫn feed thường. Bài bị Facebook làm rỗng khi cuộn ra ngoài màn hình sẽ được phân loại lại khi đổ nội dung lại.
- Nhớ giữa các lần mở trang (mặc định bật): các bài gốc đã thấy được lưu vào `chrome.storage.local` trong 24 giờ, tối đa 500 bài. Chỉ lưu hash của nội dung (không lưu chữ gốc). Sau khi reload, bài mới trùng với bài đã nhớ sẽ bị thu gọn, còn chính bài gốc vẫn hiện. Tắt trong popup hoặc bấm **Xóa dữ liệu đã nhớ**.
- Nếu mở nhiều tab Facebook cùng lúc, tab ghi sau cùng sẽ ghi đè dữ liệu đã nhớ của tab trước.

## Nút Chặn nhanh ở comment

Mỗi comment của người khác có thêm nút **Chặn** cạnh "Trả lời". Bấm một lần: extension mở menu "..." của comment, bấm mục "Chặn <tên>" có sẵn của Facebook, rồi bấm "Xác nhận" trong hộp thoại của Facebook. Menu và hộp thoại được ẩn trong lúc chạy; nút báo "Đã chặn" khi xong. Việc chặn do Facebook thực hiện; extension không lưu danh sách chặn nào. Comment của chính bạn không có nút này.

- Facebook bỏ qua `element.click()` trên menu và hộp thoại, nên extension mô phỏng chuỗi sự kiện chuột đầy đủ (`core.js: realisticClick`).
- Mặc định bấm là chặn luôn. Bỏ chọn **Bấm Chặn là chặn luôn (không hỏi lại)** trong popup để luôn hỏi trước.
- Nếu menu comment không có mục "Chặn" (ví dụ quyền quản trị viên hoặc Facebook đổi menu), `background.js` mở trang cá nhân ở một tab nền (không chuyển tab); `profile-block.js` tự bấm "..." > "Chặn" > xác nhận, rồi tab tự đóng và nút ở comment báo kết quả. Chỉ tab do chính extension mở (background kiểm tra theo id tab) mới được tự chặn, nên link bên ngoài có `#dedup-block` không kích hoạt được việc chặn. Nếu thất bại, tab được đưa lên phía trước kèm thông báo để bạn chặn thủ công.
- Tắt hẳn nút bằng công tắc **Hiện nút Chặn nhanh ở mỗi comment**.

## Test

```
node --test tests/
```

## Lưu ý

Facebook thường đổi DOM; nếu không nhận diện được tác giả/nội dung, chỉnh các selector ở đầu `content.js`.
# fb-group-post-dedup
