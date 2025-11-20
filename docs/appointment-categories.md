# Appointment Category Migration & API Notes

Appointment types now reference a dedicated `appointment_categories` table via a single `category_id` field. Each company controls its own categories, and the API can still create new ones on the fly when saving an appointment.

## API updates for the frontend

All `/scheduling/*` routes keep using the authenticated token.

### Appointment category CRUD

| Method & Path | Description | Body | Response |
| --- | --- | --- | --- |
| `GET /scheduling/appointment-categories` | List categories for the current company | _none_ | `[{ id, name, companyId, createdAt, updatedAt }]` |
| `POST /scheduling/appointment-categories` | Create a category | `{ "name": "Walk-ins" }` | `201` with the created category |
| `PUT /scheduling/appointment-categories/:id` | Rename a category | `{ "name": "VIP" }` | `200` `{ id, name }` |
| `DELETE /scheduling/appointment-categories/:id` | Remove a category and unlink it from all appointment types | _none_ | `204` |

### Appointment type payload

`POST /scheduling/appointment-types` and `PUT /scheduling/appointment-types` accept a single optional category reference:

```json
{
  "id": 12, // only for PUT
  "name": "Introductiegesprek",
  "duration": 30,
  "price": 45,
  "description": "Kennismaking",
  "categoryId": 3,
  "newCategoryName": "Premium klantenservice"
}
```

- Send `categoryId` with an existing ID to link the appointment to that category.
- Send `categoryId: null` to remove the category from the appointment.
- Send `newCategoryName` (or `newCategory`) to create a label on the fly and link it immediately; you can omit `categoryId` in that case.
- If neither `categoryId` nor `newCategoryName` are provided in a `PUT`, we keep the current category.

`GET /scheduling/appointment-types` and the responses from `POST/PUT` now include:

```json
{
  "id": 12,
  "name": "...",
  "duration": 30,
  "price": 45,
  "description": "...",
  "categoryId": 3,
  "category": { "id": 3, "name": "Walk-ins", "companyId": "123", "createdAt": "...", "updatedAt": "..." }
}
```

### Suggested frontend flow

1. Use `GET /scheduling/appointment-categories` to populate the category dropdown per company.
2. If the user types a new label, either:
   - Call `POST /scheduling/appointment-categories` immediately and reuse the returned ID, or
   - Include the label in `newCategoryName` when saving the appointment so the backend creates it automatically.
3. When editing an appointment type, omit `categoryId` to keep the current value, send `categoryId` with a numeric ID to change it, or send `null` to clear it.
