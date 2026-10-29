# Các bước anh tự làm trước khi build (khoảng 15–20 phút, miễn phí)

1. **Tạo site Jira dành cho dev:** vào http://go.atlassian.com/cloud-dev, đăng nhập bằng tài khoản
   Atlassian (tạo mới bằng Gmail nếu chưa có) rồi làm theo wizard. Anh nhận được một site dạng
   `xxx.atlassian.net`, có Jira và Confluence, anh là admin. Không cần chờ ai duyệt.
2. **Kiểm tra Rovo:** ĐÃ XONG (Claude kiểm tra 29/10: Rovo bật cho mọi ứng dụng trong tổ chức configdoctor).
3. **Cài Node.js 22 LTS** (bản Windows .msi từ nodejs.org), rồi mở PowerShell gõ `node -v`.
4. **Cài Forge CLI:** `npm install -g @forge/cli`, rồi gõ `forge --version`.
5. **Tạo API token:** vào https://id.atlassian.com/manage-profile/security/api-tokens, chọn
   "Create API token with scopes", chọn app **Forge**, đặt hạn dùng, rồi copy token. Không gửi
   token cho ai, kể cả dán vào chat.
6. **Đăng nhập:** `forge login`, nhập email và token. Gõ `forge whoami` để kiểm tra.
7. **Site dev đã có:** https://configdoctor.atlassian.net (Rovo đã bật ở cấp tổ chức).
8. **Tạo repo:** tạo thư mục `config-doctor`, giải nén harness này vào, `git init`, rồi mở bằng
   coding agent (Codex hoặc Claude Code).
9. Dán nội dung `prompts/01_M0_bootstrap.md` vào coding agent. Site đã được điền sẵn.
