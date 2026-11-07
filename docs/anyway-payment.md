# Anyway Payment Integration (anyway.sh)

[Anyway](https://anyway.sh) 是一个面向独立开发者与 AI 原生应用的 **MoR（Merchant of Record，记录商家/代销商）** 支付与结算基础设施。

## 为什么适合个人开发者？

1. **个人身份直接入驻**：无需繁琐注册海外公司（如美国 LLC），个人开发者即可申请开通。
2. **支持直接提现到国内**：支持提现至中国大陆银行卡或支付宝。
3. **免去全球税务合规烦恼**：Anyway 作为销售主体代扣代缴全球销售税（VAT/Sales Tax）。
4. **费率优势**：相比同类 MoR 平台更具竞争力（约 3.9% + $0.50/笔）。

---

## 1. 站点配置 (`site.config.ts`)

在站点的 `site.config.ts` 中将支付提供商切换为 `anyway`：

```typescript
export default defineSite({
  id: 'mysite',
  name: 'My AI App',
  url: 'https://mysite.com',
  // ...
  products: [
    {
      id: 'pack_10',
      kind: 'credits',
      name: '10 Credits',
      price: { amount: 999, currency: 'usd' }, // 9.99 USD
      credits: 10,
      expiresDays: null,
      // 如果你在 Anyway 后台创建了对应 Product，可在此填入 product_id（可选）：
      // refs: { anyway: 'prod_xxxx' },
    },
  ],
  billing: {
    provider: 'anyway',
    // endpoint: 'https://merchant-api-prod.anyway.sh', // 可选，默认即为官方生产端点
  },
});
```

---

## 2. 环境变量配置

在 `.dev.vars`（本地）或 Cloudflare Worker Secrets（线上）中提供两个密钥：

```bash
# Anyway 开发者后台获取的 API Key
ANYWAY_API_KEY=your_api_key_here

# Anyway Webhook 签名密钥（格式为 whsec_xxx 或 base64 字符串）
ANYWAY_WEBHOOK_SECRET=whsec_your_secret_here
```

线上部署时设置密钥：
```bash
pnpm wrangler secret put ANYWAY_API_KEY
pnpm wrangler secret put ANYWAY_WEBHOOK_SECRET
```

---

## 3. 配置 Webhook 回调地址

登录 [Anyway 开发者控制台](https://anyway.sh)，在 Webhook 设置中添加你的站点端点：

- **URL**: `https://<your-domain>/api/webhooks/anyway`
- **监听事件**: `order.paid`, `order.failed`

收到支付成功通知后，系统会自动通过标准 Webhook 规范（Standard Webhooks / HMAC-SHA256）验证防伪签名，并自动、幂等地为对应用户充值到账积分。
