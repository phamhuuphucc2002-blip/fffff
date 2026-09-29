# ARCANUM — Cloud Sync Edition

Bản cloud nâng cấp từ Arcanum Standalone hiện tại. Mục tiêu là cho nhiều thành viên cùng dùng một thư viện kiến thức mà không làm mất dữ liệu cá nhân.

## 1. Phân vùng dữ liệu
- **Shared / Dùng chung:** hồ sơ trong Kho Lưu Trữ (`entries`) khi `visibility !== "private"`.
- **Private / Riêng tư:** hồ sơ có `visibility: "private"`, không đẩy lên workspace.
- **Grimoire & Nhật ký:** `notes` tiếp tục chỉ nằm trên thiết bị trong bản này.
- **PDF:** metadata có thể đồng bộ theo hồ sơ; file PDF gốc vẫn dùng IndexedDB cục bộ ở v1.

## 2. Đồng bộ
Arcanum giữ cache cục bộ và cloud version. Sau khi app lưu dữ liệu, lớp Cloud Sync đợi khoảng 1,6 giây rồi đẩy phần Shared. Server tăng `version` sau mỗi lần ghi. Nếu phiên bản cloud không còn khớp `baseVersion`, server trả HTTP 409 để ngăn ghi đè âm thầm.

Ngoài ra app kiểm tra version cloud khoảng mỗi 30 giây và báo khi có thay đổi mới; người dùng chọn **Lấy dữ liệu cloud** để hợp nhất vào thiết bị. Hồ sơ Private trên máy được giữ lại khi Pull.

## 3. Tài khoản & workspace
- Đăng ký tạo một workspace Arcanum mặc định.
- Có thể tạo thêm workspace.
- Thành viên tham gia bằng `join_code`.
- Owner và editor có quyền ghi dữ liệu Shared. Thành viên mới vào bằng mã được cấp `editor` ở v1 để thao tác ngay.
- Mô hình role đã sẵn sàng để bổ sung quản trị viên, mời email, thu hồi quyền.

## 4. Chạy local
Cần Node.js 20+ và PostgreSQL.

```bash
npm install
# tạo .env từ .env.example
npm start
```

Sau đó mở `http://localhost:3000`. Database schema được tạo tự động khi server khởi động.

## 5. Deploy
`render.yaml` là blueprint tham khảo cho Render. Có thể dùng nhà cung cấp khác miễn có Node.js server và PostgreSQL.

## 6. Dữ liệu hiện tại
Bản Arcanum cũ dùng `localStorage` cho hồ sơ và IndexedDB cho PDF. Sau khi đăng nhập vào Cloud Sync, dùng **Đẩy dữ liệu lên cloud** để đưa các hồ sơ Shared hiện có lên workspace. Trước lần đầu chuyển dữ liệu, nên xuất bản sao HTML/JSON hiện tại.

## 7. Lộ trình production tiếp theo
1. File storage cho PDF/ảnh bằng object storage.
2. Đồng bộ theo từng record thay vì gửi toàn bộ kho trong một JSON.
3. Lịch sử phiên bản theo hồ sơ và khôi phục.
4. Admin panel cho thành viên/role.
5. Audit log và soft-delete.
6. Tìm kiếm server-side cho kho lớn.
