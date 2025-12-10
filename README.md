# Commerce Integrations (Shopify & WooCommerce)

This backend supports connecting Shopify and WooCommerce stores so the platform can expose product/order data to AI tools.

## Environment variables
- `SHOPIFY_CLIENT_ID` – Shopify app client ID
- `SHOPIFY_CLIENT_SECRET` – Shopify app client secret
- `SHOPIFY_REDIRECT_URI` – Backend callback URL, e.g. `https://api.example.com/shopify/callback`
- `SHOPIFY_SCOPES` – Comma-separated scopes, e.g. `read_products,read_orders` (defaults to these scopes if unset)
- `SHOPIFY_API_VERSION` – Optional Shopify Admin API version (default `2024-07`)
- `WOOCOMMERCE_API_VERSION` – Optional API version, defaults to `wc/v3`

## Shopify flow
1. Authenticated client POSTs `/shopify/start` with `shopDomain` (e.g. `mystore` or `mystore.myshopify.com`) to receive `{authUrl, state}`.
2. Redirect the user to `authUrl`.
3. Shopify redirects to `/shopify/callback?code=...&state=...&shop=...` where the backend exchanges the code, encrypts the access token, and stores it per company.
4. Check connection with `GET /shopify/status`; disconnect with `DELETE /shopify/disconnect`.
5. List all commerce connections with `GET /commerce/stores` (returns Shopify and WooCommerce status).

## WooCommerce flow
1. Authenticated client POSTs `/woocommerce/connect` with `storeUrl`, `consumerKey`, `consumerSecret`, and optional `apiVersion`.
2. Credentials are encrypted at rest and stored per company.
3. Check connection with `GET /woocommerce/status`; disconnect with `DELETE /woocommerce/disconnect`.
4. List all commerce connections with `GET /commerce/stores`.

## Notes
- Secrets/keys are encrypted with the existing `MASTER_KEY`.
- Database tables expected: `shopify_integrations` and `woocommerce_integrations` (see repository SQL for columns). Create migrations accordingly.
- AI tools (for the voice agent) now support:
  - `get_product_details_by_name` with `storeId` (`shopify`|`woocommerce`) and `productName` (fuzzy match).
  - `get_order_status` with `storeId` (`shopify`|`woocommerce`) and `orderId`.
  Both return errors if the selected store isn’t connected for the company.
- The `/integrations/get` endpoint now returns `connectUrl` and `connectMethod` per integration so the frontend knows which endpoint to call when the user clicks “connect”.

## API examples (authenticated)

### List connected stores
```
curl -H "Authorization: Bearer <JWT>" https://api.example.com/commerce/stores
```

### Shopify
```
# Start OAuth
curl -X POST -H "Authorization: Bearer <JWT>" \
  -H "Content-Type: application/json" \
  -d '{"shopDomain":"mystore"}' \
  https://api.example.com/shopify/start

# Callback is handled by Shopify redirecting to your backend: /shopify/callback?code=...&state=...&shop=...

# Status
curl -H "Authorization: Bearer <JWT>" https://api.example.com/shopify/status

# Disconnect
curl -X DELETE -H "Authorization: Bearer <JWT>" https://api.example.com/shopify/disconnect
```

### WooCommerce
```
# Connect via REST creds
curl -X POST -H "Authorization: Bearer <JWT>" \
  -H "Content-Type: application/json" \
  -d '{"storeUrl":"https://store.example.com","consumerKey":"ck_xxx","consumerSecret":"cs_xxx","apiVersion":"wc/v3"}' \
  https://api.example.com/woocommerce/connect

# Status
curl -H "Authorization: Bearer <JWT>" https://api.example.com/woocommerce/status

# Disconnect
curl -X DELETE -H "Authorization: Bearer <JWT>" https://api.example.com/woocommerce/disconnect
```
