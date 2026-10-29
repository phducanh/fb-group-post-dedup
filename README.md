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

## Cách hoạt động

- Mỗi bài top-level (`[role="article"]`, bỏ qua comment) được trích xuất: tác giả, nhóm, post id, nội dung.
- Nội dung được chuẩn hoá (bỏ dấu, link, ký tự đặc biệt) rồi so bằng overlap của các cụm 3 từ, nên bản bị cắt "Xem thêm" vẫn khớp.
- Bài render lại bởi Facebook (cùng post id) không bị tính là trùng với chính nó.
- Hỗ trợ cả trang Feeds (`sk=h_chr`, không có `role="article"`, mỗi bài là một `div[data-virtualized]`) lẫn feed thường. Bài bị Facebook làm rỗng khi cuộn ra ngoài màn hình sẽ được phân loại lại khi đổ nội dung lại.
- Nhớ giữa các lần mở trang (mặc định bật): các bài gốc đã thấy được lưu vào `chrome.storage.local` trong 24 giờ, tối đa 500 bài. Chỉ lưu hash của nội dung (không lưu chữ gốc). Sau khi reload, bài mới trùng với bài đã nhớ sẽ bị thu gọn, còn chính bài gốc vẫn hiện. Tắt trong popup hoặc bấm **Xóa dữ liệu đã nhớ**.
- Nếu mở nhiều tab Facebook cùng lúc, tab ghi sau cùng sẽ ghi đè dữ liệu đã nhớ của tab trước.

## Test

```
node --test tests/
```

## Lưu ý

Facebook thường đổi DOM; nếu không nhận diện được tác giả/nội dung, chỉnh các selector ở đầu `content.js`.
