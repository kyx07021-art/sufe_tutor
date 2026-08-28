/**
 * awards 域数据层（S6-A5 下线态）：teacher_awards 表已下线（不保留向后兼容），
 * 全部数据函数（initAwardsTable/dbCreateAward/dbCountAwardsByTeacher/dbGetAwardById/
 * dbGetAwardsByTeacher/dbGetAwardsAdmin/dbDeleteAward/dbSetAwardStatus 等）随之下线删除。
 *
 * 保留文件——archtest「后端域自持」要求 domains/awards/ 三件套文件存在。
 * 本文件零外部引用（schema.js/api.js 不再 import 它），无导出。
 */
