-- v1.0.0 正式版清库（R8-3）：全站业务数据清空，仅保留管理员账户与 schema_meta
-- 用法：npx wrangler d1 execute af8ba698-d949-4acb-b2ee-73073c627b72 --remote --file=clear_db.sql
DELETE FROM auth_sessions;
DELETE FROM rate_limits;
DELETE FROM verification_codes;
DELETE FROM danger_caps;
DELETE FROM teacher_awards;
DELETE FROM teacher_profiles;
DELETE FROM student_demands;
DELETE FROM reviews;
DELETE FROM invite_codes;
DELETE FROM demand_intents;
DELETE FROM demand_pushes;
DELETE FROM conversations;
DELETE FROM messages;
DELETE FROM uploads;
DELETE FROM posts;
DELETE FROM post_likes;
DELETE FROM post_favorites;
DELETE FROM complaints;
DELETE FROM feedbacks;
DELETE FROM user_settings;
DELETE FROM signing_requests;
DELETE FROM contracts;
DELETE FROM contract_ledger;
DELETE FROM notifications;
DELETE FROM activity_log;
DELETE FROM users WHERE role != 'admin';
