# Ghost 后台与写作指南

## 两种账号不要混淆

- **后台作者账号**：用于进入 Ghost Admin、写文章、管理评论和站点设置。
- **前台读者账号**：读者用邮箱免费注册，用于评论和接收邮件。它不是付费会员；当前评论权限是 `all`，注册权限也是 `all`。

## 登录后台

后台地址：<https://blog.somnus.wiki/ghost/#/signin>

Owner 邮箱是 `mailmeblog@somnus.wiki`。随机初始密码仅保存在部署电脑的
`.private/ghost-owner.json`，该文件权限为 `0600`，不会提交到 Git。

首次登录后，建议在左下角头像菜单中进入个人设置，换成自己容易保管的强密码。

## 写一篇文章

1. 登录后台，打开左侧 **Posts**，点击 **New post**。
2. 输入标题和正文。输入 `/` 可以插入图片、Markdown、代码、分割线等内容块。
3. 点击右上角设置按钮，填写摘要、封面图、发布时间和标签。
4. 必须添加下面一个内部标签，否则文章不会进入对应集合：

   - 普通文章：`#文章`
   - 笔记：`#笔记`
   - 随笔：`#随笔`
   - 日记：`#日记`

5. 还可以继续添加公开标签，例如 `Linux`、`Rust`、`AI`。以 `#` 开头的标签只用于站内路由，不会显示给读者。
6. 点击 **Publish**，确认发布时间与访问权限后发布。访问权限保持 **Public** 即可。

页面型内容（例如友链、隐私政策）应从左侧 **Pages** 创建，不需要内部分类标签。

## 评论与免费注册

评论面向所有已注册读者开放，不要求付费。读者点击文章底部的 **免费注册**，用邮箱创建前台账号后即可评论。

Ghost 的读者登录使用邮件验证链接，因此正式开放读者注册前需要配置 SMTP。需要准备：SMTP 主机、端口、用户名、密码和发件人地址。后台作者登录不依赖这套邮件链接。

## 常用维护命令

```bash
ssh tencent-cloud
cd /home/ubuntu/ghost-blog
docker compose ps
docker compose logs -f ghost
```

每日备份由 `ghost-blog-backup.timer` 执行，备份目录为
`/home/ubuntu/ghost-blog/backups`，默认保留 14 天。若 `.env` 已配置 Restic，
同一任务还会把加密备份发送到异地仓库，并保留 14 个日备份、8 个周备份和
12 个月备份。运行日志与临时主题回滚目录不会写入内容归档。
`ghost-blog-backup-verify.timer` 每周把最新 SQL 实际恢复到隔离的临时 MySQL，
同时验证并解压对应内容归档。可以运行 `make verify-backup` 手工触发。还应定期
运行 `restic snapshots`，并至少每季度从异地 Restic 仓库完整恢复一次。

## 发布前隐私检查

日记、课程材料和论文记录尤其要检查姓名、学号、手机号、住址、私人邮箱和原始
附件文件名。已知的 `2026-05-21` 日记可以在持有本机 Owner 凭据的设备上执行：

```bash
python3 scripts/redact_public_pii.py
python3 scripts/redact_public_pii.py --apply
```

第一条只报告会处理的字段；第二条先在 `.private/redaction-backups/` 保存
权限为 `0600` 的原文备份，再更新线上文章。
