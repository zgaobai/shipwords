# Waffo 支付集成指南 (Waffo & Waffo Pancake)

本文档介绍如何在 `shipwords` 项目中接入并使用 **Waffo**（包含面向独立开发者与出海产品的 **Waffo Pancake**）全球支付与 MoR（名义销售方）收银台。

---

## 1. 核心特性

- **适配器抽象解耦**：基于 `packages/core/src/billing/waffo.ts` 实现统一的 `PaymentProvider` 接口。
- **免手动预置价格**：商品目录直接在 `site.config.ts` 中声明，系统自动将订单、用户与商品信息挂载至 Waffo 会话。
- **双通道到账保障**：
  - **快速通道**：用户在 Waffo 收银台付款后跳转回 `/billing/return`，前端主动触发 `/api/billing/sync` 反查 Waffo 权威状态即时发币；
  - **可靠兜底**：Webhook 异步信标验签后触发权威对账，幂等入账。
- **签名验证全面兼容**：内置 Web Crypto API 验签，原生支持 Waffo 平台的 **RSA-SHA256 公钥（PEM格式）** 与 **HMAC-SHA256 密钥**。

---

## 2. 站点配置

### 2.1 修改 `site.config.ts`

在目标站点的 `site.config.ts` 中将支付渠道设置为 `waffo`：

```ts
export const site = defineSite({
  id: 'my-ai-site',
  name: 'My AI Site',
  url: 'https://my-ai-site.com',
  // ... 其他配置
  billing: {
    provider: 'waffo',
    // 可选：自定义 API 网关地址，默认是 https://api.waffo.com
    // endpoint: 'https://api.waffo.com',
  },
  products: [
    {
      id: 'pack_100',
      kind: 'credits',
      name: '100 Credits',
      price: { amount: 999, currency: 'usd' }, // 999 代表 $9.99 (按货币最小单位)
      credits: 100,
      expiresDays: null,
    },
    {
      id: 'pack_500',
      kind: 'credits',
      name: '500 Credits',
      price: { amount: 3999, currency: 'usd' },
      credits: 500,
      expiresDays: null,
    },
  ],
});
```

---

## 3. 环境变量与密钥配置

在对应站点的 `.dev.vars`（本地）或 Cloudflare Worker Secrets（线上）中注入以下变量：

| 变量名                 | 必填 | 说明                                                                            |
| :--------------------- | :--: | :------------------------------------------------------------------------------ |
| `WAFFO_API_KEY`        |  是  | Waffo 开放平台生成的 API Key / Access Token                                     |
| `WAFFO_WEBHOOK_SECRET` |  是  | Waffo 商户后台提供的 Webhook 验签密钥（支持 RSA 公钥 PEM 字符串或 HMAC Secret） |
| `WAFFO_ENDPOINT`       |  否  | API 基础地址，留空默认使用 `https://api.waffo.com`                              |

### 3.1 本地开发环境配置

在站点目录下的 `.dev.vars` 中填写（或放在 `~/.config/shipwords/<site>.dev.vars`）：

```bash
WAFFO_API_KEY=waffo_sec_test_xxxxxx
WAFFO_WEBHOOK_SECRET=your_waffo_webhook_secret_or_public_key
WAFFO_ENDPOINT=https://api.waffo.com
```

### 3.2 生产环境部署配置

进入目标站点目录，通过 Cloudflare Wrangler 录入密钥：

```bash
cd sites/<your-site>
pnpm wrangler secret put WAFFO_API_KEY
pnpm wrangler secret put WAFFO_WEBHOOK_SECRET
```

---

## 4. Waffo 商户后台 Webhook 设置

1. 登录 [Waffo 商户中心](https://waffo.com)。
2. 进入 **Integration** / **Developers** -> **Webhooks** 设置。
3. 添加 Webhook 接收地址（Notification URL）：

   ```
   https://<你的站点域名>/api/webhooks/waffo
   ```
4. 订阅事件（Event Types）：
   - `PAYMENT_NOTIFICATION` 或 `payment.succeeded`（支付成功）
   - `refund.created` / `PAYMENT_REFUNDED`（退款事件）
   - `CUSTOMER.DISPUTE.CREATED` / `CUSTOMER.DISPUTE.RESOLVED`（争议事件）
5. 将商户后台生成的 Webhook 签名公钥（或签名 Secret）复制并写入上述的 `WAFFO_WEBHOOK_SECRET` 环境变量中。

---

## 5. 验证与联调流程

1. **发起支付**：在前端点击购买任意套餐，页面会调用 `/api/billing/checkout` 创建订单，并自动重定向至 Waffo 托管收银台页面。
2. **完成测试付款**：在 Waffo 沙箱/测试收银台中完成付款。
3. **状态跳转与确认**：
   - 支付完成后自动跳转回 `https://<你的站点域名>/billing/return?order=ord_xxx`；
   - 该页面会自动轮询 `/api/billing/sync`，即刻主动拉取 Waffo 订单结果；
   - 确认到账后，积分原子性发放到账，界面呈现勾选动画并在 3.5 秒后跳转回原工具生成页。
4. **退款测试**：在 Waffo 后台对该订单发起退款，系统通过 Webhook 或状态同步检测到退款后，会自动按比例扣回发放的积分；若积分已消费，会自动生成账户债务（`debt`）。
