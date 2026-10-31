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
- Bài render lại bởi Facebook (cùng post id + nhóm + tác giả) không bị tính là trùng với chính nó.
- Tin rao Marketplace đăng lại ở nhiều nhóm (cùng link `/marketplace/item/<id>`) và các lượt chia sẻ cùng một bài (cùng link tới bài gốc) được coi là trùng mà không cần so nội dung, kể cả khi do những người khác nhau chia sẻ (tuỳ chọn "chỉ cùng người đăng" không áp dụng cho trường hợp này).
- Hỗ trợ cả trang Feeds (`sk=h_chr`, không có `role="article"`, mỗi bài là một `div[data-virtualized]`) lẫn feed thường. Bài bị Facebook làm rỗng khi cuộn ra ngoài màn hình sẽ được phân loại lại khi đổ nội dung lại.
- Nhớ giữa các lần mở trang (mặc định bật): các bài gốc đã thấy được lưu vào `chrome.storage.local` trong 24 giờ, tối đa 500 bài. Chỉ lưu hash của nội dung (không lưu chữ gốc). Sau khi reload, bài mới trùng với bài đã nhớ sẽ bị thu gọn, còn chính bài gốc vẫn hiện. Tắt trong popup hoặc bấm **Xóa dữ liệu đã nhớ**.
- Trong mỗi nhóm bài trùng, **bản mới nhất (nằm cao nhất trong feed) luôn được hiện**; các bản cũ hơn bị thu gọn. Nếu một bài nằm cao hơn bản đang hiện (ví dụ bài mới xuất hiện sau reload) thì nó thay thế bản cũ, và bản cũ được thu gọn kèm dòng "Bài cũ trùng nội dung…; bản mới nhất đang hiện ở nhóm …". Bài đã nhớ từ lần mở trước luôn được coi là cũ hơn bài đang thấy.
- Trang chi tiết một bài (mở từ link bài, thông báo…, ví dụ `/groups/<nhóm>/posts/<id>/`) không có thứ tự bảng tin, nên bài trùng với bài đã xem luôn bị thu gọn (có nút **Hiện bài**); chính bài gốc (cùng id bài, cùng nhóm) không bao giờ bị thu gọn. Người đăng được nhận ra cùng một người dù link là `/groups/<nhóm>/user/<id>` (bảng tin nhóm) hay `/profile.php?id=<id>` (trang chi tiết).
- Nếu mở nhiều tab Facebook cùng lúc, tab ghi sau cùng sẽ ghi đè dữ liệu đã nhớ của tab trước.

## Nút Chặn nhanh ở comment

Mỗi comment của người khác có thêm nút **Chặn** cạnh "Trả lời". Bấm một lần: extension mở menu "..." của comment, bấm mục "Chặn <tên>" có sẵn của Facebook, rồi bấm "Xác nhận" trong hộp thoại của Facebook. Menu và hộp thoại được ẩn trong lúc chạy; nút báo "Đã chặn" khi xong. Việc chặn do Facebook thực hiện; extension không lưu danh sách chặn nào. Comment của chính bạn không có nút này.

- Facebook bỏ qua `element.click()` trên menu và hộp thoại, nên extension mô phỏng chuỗi sự kiện chuột đầy đủ (`core.js: realisticClick`).
- Mặc định bấm là chặn luôn. Bỏ chọn **Bấm Chặn là chặn luôn (không hỏi lại)** trong popup để luôn hỏi trước.
- Nếu menu comment không có mục "Chặn" (ví dụ quyền quản trị viên hoặc Facebook đổi menu), `background.js` mở trang cá nhân ở một tab nền (không chuyển tab); `profile-block.js` tự bấm "..." > "Chặn" > xác nhận, rồi tab tự đóng và nút ở comment báo kết quả. Chỉ tab do chính extension mở (background kiểm tra theo id tab) mới được tự chặn, nên link bên ngoài có `#dedup-block` không kích hoạt được việc chặn. Nếu thất bại, tab được đưa lên phía trước kèm thông báo để bạn chặn thủ công.
- Tắt hẳn nút bằng công tắc **Hiện nút Chặn nhanh ở mỗi comment**.

## Theo dõi bài đấu giá

Quét bài đấu giá trong các nhóm theo dõi (mặc định `316605308060947` và `426208205081`) và liệt kê: hạn kết thúc (ngày, giờ), giá cao nhất hiện tại, link bài.

- Bấm **Xem bài đấu giá** trong popup để mở `auctions.html`. Danh sách hiện ngay dữ liệu đã có và tự quét lại (`auction-sweep.js`) trong một cửa sổ nhỏ, xong tự đóng; danh sách cập nhật trực tiếp trong lúc quét. Thứ tự một lượt quét:
  1. **Cập nhật bài đã có qua link**: mở thẳng link từng bài trong danh sách còn hạn (tối đa 40, hạn gần nhất trước), chuyển sang "Tất cả bình luận", bấm "Xem thêm bình luận" cho tới hết để lấy giá, mua đứt, khoá bình luận, hạn mới nhất. Link báo "nội dung không hiển thị" thì bài được đánh dấu **đã bị xoá hoặc ẩn**.
  2. **Tìm bài mới trong nhóm** (xếp theo bài mới): bỏ qua bài đã có trong danh sách, thôi cuộn khi gặp 5 bài đã có liên tiếp, 5 bài quá số ngày, hoặc sau 30 lần cuộn.
  3. **Đọc bài mới tìm được** qua link (bài đã mở ở bước 1 không mở lại).
- **Bài chưa đọc được hết thông tin** (thiếu hạn, giá hoặc link, hoặc có comment có số mà không hiểu là giá): mỗi lượt quét mở lại các bài này qua link (bài chưa có link thì mở trang tìm kiếm trong nhóm, tối đa 10 bài) và lưu **mẫu nội dung** (toàn văn bài, tối đa 3.000 ký tự, và tối đa 20 comment chưa đọc được) vào `chrome.storage.local` (khóa `auctionSamples`, tối đa 50 bài). Trang danh sách có mục **Bài chưa đọc được** để xem nội dung từng bài, **Copy báo cáo** để gửi bổ sung kiểu viết. Sau khi cập nhật bộ đọc, mẫu đã lưu được đọc lại tự động (khi mở danh sách và khi bắt đầu quét), chỉ điền thông tin còn thiếu; mẫu tự xóa khi bài được mở lại và đọc đủ.
- Bản ghi trùng của cùng một bài (bản tạm chưa có id, hoặc id dạng `pfbid…`) được gộp vào bản có id số theo nhóm + đầu bài; hai id số khác nhau không bao giờ bị gộp (người bán hay dùng chung mẫu bài). Cột giá ghi lần cuối bài được kiểm tra qua link.
- Mở lại danh sách trong vòng 10 phút sau lần quét trước thì không quét lại; bấm **Quét ngay** để quét luôn, **Dừng quét** hoặc đóng cửa sổ quét để dừng. Bỏ chọn **Tự quét khi mở danh sách** để chỉ quét khi bấm. Bài đã đọc kỹ trong 10 phút qua được bỏ qua; bài đã kết thúc chỉ được đọc thêm một lần sau hạn để lấy giá chốt.
- Cửa sổ quét phải hiện trên màn hình: Chrome ngừng vẽ tab nền, cửa sổ thu nhỏ hoặc bị che kín, khi đó Facebook không tải thêm bài/bình luận. Mỗi bước có giới hạn thời gian (nhóm 4 phút, bài 2 phút) nên quét không bị treo.
- Vẫn có thể quét tay: mở nhóm và cuộn, hoặc bấm **Tự cuộn** ở bảng nhỏ góc trái dưới.
- Bài được coi là bài đấu giá khi có từ như "đấu giá", "ĐG", "auc", "bước giá", "giá khởi điểm", "start", "step", "bid"… hoặc có hạn kết thúc. Extension tự bấm "Xem thêm" ở bất kỳ đâu trong bài (thử lại tối đa 3 lần nếu Facebook bỏ qua cú bấm) để đọc phần bị cắt.
- Nhận bài cả khi bảng tin nhóm không dùng `role="article"` (mỗi khối con của `role="feed"` là một bài). Id bài lấy từ link bài, link bình luận hoặc album ảnh (`set=gm.<id>`/`pcb.<id>`); link thời gian còn là `#` thì giả lập rê chuột để Facebook điền link. Bài chưa lấy được id vẫn được ghi, kèm link tìm kiếm trong nhóm, và được thay bằng link thật khi đọc được id.
- Danh sách (và file CSV) mặc định xếp theo **hạn kết thúc**: phiên đang diễn ra hết hạn sớm nhất lên đầu, rồi bài chưa đọc được hạn, cuối cùng là bài đã kết thúc / đã có người mua đứt. Chọn **Bài mới nhất** để xếp theo bài đăng mới nhất (theo id bài). Lượt quét mở nhóm theo "Bài viết mới" (tham số `sorting_setting=CHRONOLOGICAL`, và chọn ở nút sắp xếp nếu có).
- Nếu vẫn sót bài: mở nhóm, bấm **Chẩn đoán** trong popup; phần `auctions` cho biết mỗi bài có được nhận là bài đấu giá, có id, còn nút "Xem thêm" hay không.
- Hạn kết thúc đọc sau các từ "kết thúc", "chốt", "end", "KT"…: hiểu `21h30`, `21:30`, `9pm`, `9h tối`, `2/11`, `02/11/2024`, `ngày 5 tháng 11`, `thứ 7`, `CN`, `tối nay`, `mai`. Thiếu ngày hoặc giờ thì hạn được đánh dấu `≈` (ước lượng). "Tối nay", "thứ 7" được tính theo lúc extension thấy bài lần đầu.
- Giá trả lấy từ các comment ngắn chỉ có một con số: `250k`, `250`, `theo 300`, `1tr2 ạ`, `3m1` (= 3.100.000), `3m15`, `3tr100k`, `3 triệu 1 trăm`, `3 củ 1`, `3c1`, `3.1` / `3,1 triệu` (= 3,1 triệu), `3.100`, `3.100.000đ`, `5 trăm`, `5 lít 5`… Số trần dưới 10.000 hiểu là nghìn đồng, số trần có phần lẻ dưới 100 hiểu là triệu. Bỏ qua comment dài, có số điện thoại, nhiều con số, câu hỏi, `+10k` (tăng thêm), "bước giá", "ship", `1k2` (không rõ nghĩa) và giá dưới 10.000đ. Giá cao nhất = lớn nhất giữa các comment và "giá hiện tại" ghi trong bài.
- **Bài nhiều món** (mỗi dòng một suất: `S1 …`, `S2 …`, `SP1`, `Suất 1`, `Slot 1`, `Món 1`, `#1`): giá trả trong comment ghi kèm suất (`S1 20`, `s2: 30k`, `S3=1tr`, `sp1 50 ạ`, `Suất 2 120k`) được tính riêng cho từng suất; danh sách hiện giá cao nhất và số lượt của mỗi suất kèm tên món, file CSV ghi `S1 50000; S2 30000`. Comment ghi nhiều suất cùng lúc thì bỏ qua.
- **Mua đứt**: comment ngắn có "đứt" ("Đứt", "em đứt", "mua đứt"; không tính câu hỏi như "ai đứt chưa?") hoặc bài ghi "đã đứt", "đứt rồi", "đã bán" thì bài được đánh dấu **Đã có người mua đứt**, coi như đã kết thúc, giá hiện là giá mua đứt. Trong bài, "Đứt: 2tr" / "Mua ngay: 2tr" là giá mua đứt.
- **Cài đặt quét** (trong trang danh sách): chỉ quét bài đăng trong **5 ngày** gần nhất (đổi được) và **bỏ qua bài đã khoá bình luận** (mặc định bật). Ngày đăng đọc từ nhãn thời gian của bài ("3 giờ", "2 ngày", "Hôm qua lúc…", "3 tháng 11 lúc…"); không đọc được thì vẫn biết chắc bài cũ nếu extension đã thấy nó từ trước mốc, hoặc có bài id lớn hơn đã quá mốc. Bài khoá bình luận nhận ra qua dòng "đã tắt tính năng bình luận" hoặc có nút Thích mà không có nút Bình luận. Bài bị bỏ qua vẫn được giữ trong máy nhưng ẩn khỏi danh sách và không được mở khi quét; đổi cài đặt là hiện lại. Khi quét nhóm (xếp theo bài mới), gặp 5 bài quá số ngày thì thôi cuộn.
- Bảng tin chỉ hiện vài comment; lượt quét tự động mở từng bài để đọc hết bình luận. Khi tự mở một bài, extension cũng bấm "Xem thêm bình luận" (tối đa 40 lần). Giá đã thấy không bao giờ bị giảm.
- Dữ liệu chỉ lưu trong máy (`chrome.storage.local`, khóa `auctions`); bài hết hạn quá 7 ngày được xóa. Danh sách nhóm sửa được trong trang danh sách (dán id, tên hoặc link nhóm). Nếu Facebook đổi URL nhóm sang tên riêng, thêm tên đó vào danh sách.
- Phần đọc chữ nằm ở `auction-core.js` (có test), phần đọc DOM ở `auction.js`.

## Test

```
node --test tests/
```

## Lưu ý

Facebook thường đổi DOM; nếu không nhận diện được tác giả/nội dung, chỉnh các selector ở đầu `content.js`.
# fb-group-post-dedup
