# Ghost 文章阅读量、在线人数与点赞

本项目把文章互动拆成两个边界清晰的服务：

- Ghost 6 官方 Analytics + Tinybird：采集页面访问并计算单篇文章累计阅读数。
- Cloudflare Worker + D1：向主题提供安全的公开查询、点赞和 45 秒在线心跳。

浏览器只访问同源的 `/api/engagement/*`，Caddy 将该路径代理到 Worker 自定义域名 `engagement.somnus.wiki`。Tinybird 管理令牌和访客哈希盐只能保存为服务端密钥，不能写进主题、Git 或浏览器代码。

## 1. 登录并部署 Ghost 官方 Tinybird 数据文件

在生产服务器的项目目录运行：

```bash
make analytics-login
make analytics-deploy
make analytics-tokens
```

第一条命令会显示 Tinybird 设备登录地址和验证码。登录成功后，最后一条命令会输出以下五个值：

```dotenv
TINYBIRD_API_URL=...
TINYBIRD_WORKSPACE_ID=...
TINYBIRD_ADMIN_TOKEN=...
TINYBIRD_TRACKER_TOKEN=...
TINYBIRD_STATS_TOKEN=...
```

把它们写入服务器 `/home/ubuntu/ghost-blog/.env`，并加入：

```dotenv
COMPOSE_PROFILES=analytics
```

当前 `somnus_blog` 工作区位于 Tinybird 香港区域，因此 API 地址应为：

```dotenv
TINYBIRD_API_URL=https://api.ap-east-1.aws.tinybird.co
```

不要把真实值写入 `.env.example` 或提交到 Git。

## 2. 启用访问事件代理

`Caddyfile.snippet` 中的 `handle_path /.ghost/analytics/*` 会把同源统计事件转发到 `somnus-traffic-analytics:3000`。同步 Caddy 配置后，启动 Analytics 和 Ghost：

```bash
docker compose pull
docker compose up -d
```

访问任意文章后，在 Ghost 后台的 Analytics 页面确认出现新访问。Ghost 官方统计是第一方、无 Cookie 的；本项目没有把 Tinybird 写入 Token 暴露给浏览器。

## 3. 创建 Cloudflare D1

安装并登录 Wrangler：

```bash
cd worker
npx wrangler login
npx wrangler d1 create somnus-blog-engagement
```

复制示例配置：

```bash
cp wrangler.toml.example wrangler.toml
```

把 D1 创建命令返回的 `database_id` 写入 `worker/wrangler.toml`。这个文件已被 Git 忽略。

执行远程数据库迁移：

```bash
npx wrangler d1 migrations apply somnus-blog-engagement --remote
```

## 4. 配置 Worker 密钥

Ghost 部署 Tinybird 数据文件后，会创建名为 `stats_page` 的只读 Token。优先在 Tinybird 控制台的 Tokens 页面复制这个 Token；不要使用 Tracker Token。

```bash
cd worker
npx wrangler secret put TINYBIRD_STATS_TOKEN
npx wrangler secret put VISITOR_HASH_SALT
```

`VISITOR_HASH_SALT` 使用新的随机值，例如：

```bash
openssl rand -hex 32
```

示例配置已经包含当前 Ghost 的 `site_uuid`，以及 Worker 自定义域名：

```text
engagement.somnus.wiki
```

部署：

```bash
npx wrangler deploy
```

由于 `blog.somnus.wiki` 当前是 DNS-only、不会经过 Cloudflare 边缘路由，生产 Caddy 还需要加入：

```caddyfile
handle /api/engagement/* {
    reverse_proxy https://engagement.somnus.wiki
}
```

## 5. 接口与隐私行为

主题调用三个同源接口：

```text
GET  /api/engagement/:post_uuid
POST /api/engagement/:post_uuid/presence
POST /api/engagement/:post_uuid/like
```

- 阅读量来自 Ghost 官方 Tinybird `api_post_visitor_counts` Pipe。
- 在线人数只统计最近 45 秒仍在发送心跳的浏览器会话。
- 在线会话 ID 只保存在 `sessionStorage`，关闭标签页后失效。
- 只有用户主动点赞后才会在 `localStorage` 生成点赞 ID。
- Worker 加盐哈希访客 ID，D1 不保存原始 ID、邮箱或 IP 地址。
- Worker 限制网页来源为 `https://blog.somnus.wiki`。

如果 Worker 尚未部署或暂时不可用，主题会自动隐藏统计和点赞，不影响文章内容、评论、目录或阅读进度。
