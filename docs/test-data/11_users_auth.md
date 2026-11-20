# 11 — Users and Authentication

> Entities: `users`, `refresh_tokens`, Redis signup state.
> Screens: `/register`, `/verify-email`, `/login`, `/forgot-password`, `/reset-password`, `/accept-invite`, `/settings/users`.
> API: `/auth/*`, `/users/*`.

---

## 1. Purpose and rules

| Rule | Value | Citation |
|---|---|---|
| Email identity | Global and case-insensitive; one user belongs to one organization | `20260702172631_enforce_global_unique_email.js:14-16` |
| Password rule | Minimum 8 characters only. No uppercase, digit, or symbol requirement. | `auth.validation.js:7,24,39` |
| First user | `org_admin`, created during OTP verification | `auth.service.js:209` |
| Invite roles | `org_admin`, `compliance_manager`, `operator`, `auditor` only | `users.validation.js:4` |
| Invite validity | 72 hours | `users.service.js:143` |
| Reset validity | 1 hour | `auth.service.js:410` |
| Access token | 30 minutes, JWT with `sub`, `orgId`, `role` | `auth.service.js:59-63` |
| Refresh token | 7 days, httpOnly cookie `refreshToken` | `auth.service.js:71`; `auth.controller.js:6-16` |
| Signup pending state | Redis `signup:<email>`, 30 minutes | `auth.service.js:114-131` |
| OTP | 6 digits, SHA-256 hashed, single use | `auth.service.js:45-56,110-116` |
| Resend throttle | Blocked while signup TTL > 780 s (about 2 minutes) | `auth.service.js:157-167` |
| Deactivation deny key | `du_<userId>`, 31 minutes | `users.service.js:10-12,272-273` |
| Auth rate limit | 50 requests per 15 minutes per email/IP key | `rateLimiter.js:87-99` |
| Generic rate limit | 1,000 requests per 15 minutes per IP/user | `rateLimiter.js:69-82,104-117` |

---

## 2. Canonical users

All active users use password `LotTrace!Test2026`. Invited users have no password until they accept. Deactivated users cannot log in.

| ID | Org | First | Last | Email | Role | Status | Purpose |
|---|---|---|---|---|---|---|---|
| `USR-001` | ORG-001 | Ava | Thompson | `ava.thompson@greenvalley.example.com` | `org_admin` | active | Primary admin |
| `USR-002` | ORG-001 | Marcus | Reed | `marcus.reed@greenvalley.example.com` | `org_admin` | active | Second admin; last-admin tests |
| `USR-003` | ORG-001 | Priya | Nair | `priya.nair@greenvalley.example.com` | `compliance_manager` | active | Exports, gaps |
| `USR-004` | ORG-001 | Daniel | Okafor | `daniel.okafor@greenvalley.example.com` | `compliance_manager` | active | Amend/void |
| `USR-005` | ORG-001 | Elena | Rossi | `elena.rossi@greenvalley.example.com` | `operator` | active | Web and PWA |
| `USR-006` | ORG-001 | Jamal | Carter | `jamal.carter@greenvalley.example.com` | `operator` | active | PWA offline |
| `USR-007` | ORG-001 | Mei | Lin | `mei.lin@greenvalley.example.com` | `operator` | active | Imports |
| `USR-008` | ORG-001 | Hannah | Schmidt | `hannah.schmidt@greenvalley.example.com` | `auditor` | active | Read-only checks |
| `USR-009` | ORG-001 | Oliver | Grant | `oliver.grant@greenvalley.example.com` | `operator` | invited | Invite expiry/resend |
| `USR-010` | ORG-001 | Rita | Alvarez | `rita.alvarez@greenvalley.example.com` | `auditor` | deactivated | Reactivation |
| `USR-011` | ORG-002 | Liam | Chen | `liam.chen@northwind.example.org` | `org_admin` | active | Cross-tenant |
| `USR-012` | ORG-002 | Grace | Park | `grace.park@northwind.example.org` | `compliance_manager` | active | |
| `USR-013` | ORG-002 | Victor | Nguyen | `victor.nguyen@northwind.example.org` | `operator` | active | |
| `USR-014` | ORG-002 | Aisha | Bello | `aisha.bello@northwind.example.org` | `operator` | active | |
| `USR-015` | ORG-002 | Tom | Becker | `tom.becker@northwind.example.org` | `auditor` | active | |
| `USR-016` | ORG-002 | Fiona | Walsh | `fiona.walsh@northwind.example.org` | `operator` | invited | |
| `USR-017` | ORG-003 | Sofia | Martinez | `sofia.martinez@harvestmoon.example.com` | `org_admin` | active | |
| `USR-018` | ORG-003 | Ben | Foster | `ben.foster@harvestmoon.example.com` | `compliance_manager` | active | |
| `USR-019` | ORG-003 | Carla | Jimenez | `carla.jimenez@harvestmoon.example.com` | `operator` | active | |
| `USR-020` | ORG-003 | Dmitri | Volkov | `dmitri.volkov@harvestmoon.example.com` | `operator` | active | |
| `USR-021` | ORG-003 | Nina | Patel | `nina.patel@harvestmoon.example.com` | `auditor` | active | |
| `USR-022` | ORG-003 | Owen | Hughes | `owen.hughes@harvestmoon.example.com` | `operator` | deactivated | Reactivation with password |
| `USR-023` | ORG-004 | Noah | Williams | `noah.williams@blueharbor.example.org` | `org_admin` | active | |
| `USR-024` | ORG-004 | Amara | Diallo | `amara.diallo@blueharbor.example.org` | `compliance_manager` | active | |
| `USR-025` | ORG-004 | Lucas | Silva | `lucas.silva@blueharbor.example.org` | `operator` | active | |
| `USR-026` | ORG-004 | Zoe | Kim | `zoe.kim@blueharbor.example.org` | `auditor` | active | |
| `USR-027` | ORG-004 | Ravi | Menon | `ravi.menon@blueharbor.example.org` | `operator` | invited | Cancel invite |
| `USR-028` | ORG-005 | Ethan | Brown | `ethan.brown@prairiegrain.example.com` | `org_admin` | active | |
| `USR-029` | ORG-005 | Maja | Nowak | `maja.nowak@prairiegrain.example.com` | `compliance_manager` | active | |
| `USR-030` | ORG-005 | Caleb | Turner | `caleb.turner@prairiegrain.example.com` | `operator` | active | |
| `USR-031` | ORG-005 | Ingrid | Larsen | `ingrid.larsen@prairiegrain.example.com` | `auditor` | active | |
| `USR-032` | ORG-005 | Diego | Ramos | `diego.ramos@prairiegrain.example.com` | `operator` | deactivated | |
| `USR-033` | ORG-006 | Chloe | Dubois | `chloe.dubois@cedarfork.example.com` | `org_admin` | active | Empty tenant |
| `USR-000` | platform | LotTrace | Admin | `admin@lottrace.com` | `super_admin` | active | Seed only |

### 2.1 How to create each status

| Status | Creation path | Notes |
|---|---|---|
| active (first admin) | Register + verify OTP | Hard-coded `org_admin` |
| active (others) | Invite + accept invite | User sets password |
| invited | Invite, do not accept | Expires after 72 h |
| deactivated | Admin deactivates an active user | Refresh tokens marked used; deny key set |
| super_admin | `npx knex seed:run` with `SEED_SUPER_ADMIN_PASSWORD` | Not creatable through API |

---

## 3. Screen: `/register` — Create Organization

Card title `Create Organization`; description `Setup your new LotTrace account` (`RegisterPage.jsx:41-43`).

| UI Label | API Field | Value to Enter | Input Type/How to Enter | Expected Result |
|---|---|---|---|---|
| Organization Name | `organizationName` | `Green Valley Fresh Foods` | Text, required, max 100 | Accepted; pending signup stored |
| First Name | `firstName` | `Ava` | Text, required, max 50 | Accepted |
| Last Name | `lastName` | `Thompson` | Text, required, max 50 | Accepted |
| Work Email | `email` | `ava.thompson@greenvalley.example.com` | Email, required, lowercased | Accepted |
| Password | `password` | `LotTrace!Test2026` | Password, required, min 8 | Accepted |
| Submit | — | click `Create Account` | Button | Redirect to `/verify-email`; toast `Registration successful! Please check your email for a verification code.` (`RegisterPage.jsx:30-33`) |

### 3.1 Registration negative cases

| ID | Input | Expected Result |
|---|---|---|
| `NEG-USR-01` | Empty Organization Name | Client message `Organization Name is required` |
| `NEG-USR-02` | Empty First Name | Client message `First Name is required` |
| `NEG-USR-03` | Empty Last Name | Client message `Last Name is required` |
| `NEG-USR-04` | Email `not-an-email` | Client message `Invalid email address`; API also returns `422` |
| `NEG-USR-05` | Password `short` (5 chars) | Client message `Password must be at least 8 characters`; API returns `422` |
| `NEG-USR-06` | Existing active email | `400 EMAIL_IN_USE`, message `Email already in use` (`auth.service.js:95`) |
| `NEG-USR-07` | Email belongs to invited user | `409 EMAIL_INVITED`, message `This email has a pending invitation. Accept the invitation from your inbox to continue.`; details field `email` (`auth.service.js:83-93`) |
| `NEG-USR-08` | Email belongs to deactivated user | `400 EMAIL_IN_USE`; same path as active (`auth.service.js:95`) |
| `NEG-USR-09` | Organization Name 101 chars | `422`, field `organizationName`, Zod max message |
| `NEG-USR-10` | Register same email twice within 30 min | First pending signup is overwritten in Redis; both return `201`. Only the latest OTP works. `[VERIFIED-CODE]` |
| `NEG-USR-11` | 51st auth request in 15 min from one email | `429`, message `Too many authentication attempts, please try again later.` (`rateLimiter.js:87-99`) |

---

## 4. Screen: `/verify-email` — Verify your email

Card title `Verify your email`; description includes the email address (`VerifyEmailPage.jsx:175-180`). Six single-digit inputs with `aria-label="Digit 1"` … `"Digit 6"`. Button `Verify Email`. Link/button `Resend code` or `Resend in Ns`.

| UI Label | API Field | Value to Enter | Input Type/How to Enter | Expected Result |
|---|---|---|---|---|
| Digit 1–6 | `otp` | 6-digit code from email/worker log | Six text inputs, numeric, one digit each; paste supported | All six filled enables `Verify Email` |
| Verify Email | `email`, `otp` | click | Button | `200`; refresh cookie set; response has `user`, `accessToken`; redirect to dashboard |
| Resend code | `email` | click | Button | `200` with generic message; 30-second client cooldown (`VerifyEmailPage.jsx:140-145`) |

### 4.1 Verify negative cases

| ID | Input | Expected Result |
|---|---|---|
| `NEG-USR-12` | Wrong 6 digits | `400 INVALID_VERIFICATION_CODE`, message `Invalid verification code` (`auth.service.js:184-186`) |
| `NEG-USR-13` | Expired signup (>30 min) | `400 INVALID_VERIFICATION_CODE`, message `Invalid or expired verification code` (`auth.service.js:179-181`) |
| `NEG-USR-14` | OTP `12345` | `422`, field `otp`, message `OTP must be exactly 6 digits` |
| `NEG-USR-15` | OTP `abcdef` | `422`, field `otp`, message `OTP must be 6 digits` |
| `NEG-USR-16` | Resend within 2 min | `429 RATE_LIMITED`, message `Please wait before requesting a new verification code.` (`auth.service.js:161-167`) |
| `NEG-USR-17` | Resend for unknown email | `200` generic success; no email sent (`auth.service.js:152-155`) |
| `NEG-USR-18` | Reload `/verify-email` with no router state | Page returns `null`; blank screen (`VerifyEmailPage.jsx:151`) `[VERIFIED-CODE]` |
| `NEG-USR-19` | Reuse a verified OTP | Redis key deleted; `400 Invalid or expired verification code` |

`EMAIL_DRY_RUN=true` writes the OTP to the worker log instead of sending mail. The exact log line depends on the transport `[UNVERIFIED-RUNTIME]`.

---

## 5. Screen: `/login`

Card title `Welcome back`; description `Login to your LotTrace account` (`LoginPage.jsx:66-68`).

| UI Label | API Field | Value to Enter | Input Type/How to Enter | Expected Result |
|---|---|---|---|---|
| Email | `email` | `ava.thompson@greenvalley.example.com` | Email input | Accepted; lowercased |
| Password | `password` | `LotTrace!Test2026` | Password input | Accepted |
| Sign In | — | click | Button | `200`; refresh cookie; `accessToken` in body; redirect to intended route or `/dashboard` |
| Forgot your password? | — | click | Link | Navigate to `/forgot-password` |
| Create account | — | click | Link | Navigate to `/register` |

### 5.1 Login negative cases

| ID | Input | Expected Result |
|---|---|---|
| `NEG-USR-20` | Wrong password | `401 INVALID_CREDENTIALS`, message `Invalid credentials` (`auth.service.js:139-146`) |
| `NEG-USR-21` | Unknown email | `401 INVALID_CREDENTIALS`, same message (no enumeration) |
| `NEG-USR-22` | Invited user before accepting | `401 INVALID_CREDENTIALS`; no password hash |
| `NEG-USR-23` | Deactivated user | `401 INVALID_CREDENTIALS`; query filters `status: 'active'` |
| `NEG-USR-24` | Empty password | Client message `Password is required`; API `422` |
| `NEG-USR-25` | Email with spaces ` ava@... ` | `422 Invalid email address`, unless trimmed by the client. React Hook Form does not trim `[VERIFIED-CODE]` |
| `NEG-USR-26` | Login with ORG-001 credentials on PWA | Allowed; PWA uses the same `/auth/login` |
| `NEG-USR-27` | 51st login attempt in 15 min | `429` auth limiter message |

### 5.2 Response body

```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "user": {
      "id": "<user-uuid>",
      "email": "ava.thompson@greenvalley.example.com",
      "role": "org_admin",
      "organizationId": "<org-uuid>"
    },
    "accessToken": "<jwt>"
  }
}
```

The refresh token is only in the `Set-Cookie: refreshToken=...; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800` header in development (`auth.controller.js:6-16,24-29`). It is not in the body.

---

## 6. Refresh, logout, and session behavior

| Case | Request | Expected |
|---|---|---|
| Refresh valid | `POST /auth/refresh` with cookie | `200`, new access token, rotated refresh cookie |
| No cookie | `POST /auth/refresh` | `401 AUTH_INVALID_REFRESH`, message `Refresh token required` (`auth.controller.js:45-47`) |
| Unknown token | Cookie with random value | `401 INVALID_TOKEN`, message `Invalid refresh token` (`auth.service.js:295-297`) |
| Expired token | Wait 7 days or edit `expires_at` | `401 TOKEN_EXPIRED`, message `Refresh token expired` (`auth.service.js:306-308`) |
| Reuse within 10 s | Send the same old refresh cookie twice quickly | `200`; returns the same replacement token (grace window) (`auth.service.js:13,310-325`) |
| Reuse after 10 s | Replay old cookie | `401 TOKEN_REUSE`, message `Token reuse detected. Please login again.`; whole session family deleted (`auth.service.js:327-335`) |
| Deactivated user refresh | Deactivate, then refresh | `401 USER_INVALID`, message `User not found or inactive` (`auth.service.js:299-302`) |
| Logout | `POST /auth/logout` with cookie and bearer | `200`, cookie cleared, refresh row marked used, access token blacklisted for remaining TTL (`auth.service.js:369-390`) |
| Reuse access token after logout | Call `GET /lots` with old bearer | `401`, message `Token has been revoked` (`authenticate.js:30-46`) |
| Deactivated access token | Use bearer after deactivation | `401`, message `Account is deactivated` (`authenticate.js:48-71`) |

---

## 7. Screens: forgot and reset password

### 7.1 `/forgot-password`

Card title `Reset Password` (`ForgotPasswordPage.jsx:34`).

| UI Label | API Field | Value to Enter | Input Type | Expected Result |
|---|---|---|---|---|
| Email | `email` | `ava.thompson@greenvalley.example.com` | Email | `200` generic message `If that email exists, a reset link has been sent` (`auth.controller.js:68-71`) |
| Submit | — | click `Send Reset Link` | Button | Same generic message for known and unknown email |

| ID | Case | Expected |
|---|---|---|
| `NEG-USR-28` | Unknown email | `200` generic; no email |
| `NEG-USR-29` | Invited user email | `200` generic; query filters `status: 'active'` (`auth.service.js:388`) |
| `NEG-USR-30` | Deactivated user | `200` generic; no reset |
| `NEG-USR-31` | Invalid email format | `422`, message `Invalid email address` |

### 7.2 `/reset-password?token=...`

Card title `Set New Password` (`ResetPasswordPage.jsx:49`).

| UI Label | API Field | Value to Enter | Input Type | Expected Result |
|---|---|---|---|---|
| New Password | `newPassword` | `LotTrace!Reset2026` | Password, min 8 | Accepted |
| Reset Password | `token` (query) | click | Button | `200`, message `Password reset successfully`; redirect to `/login` |
| Missing token | — | open `/reset-password` | — | Inline `Invalid or missing reset token.` (`ResetPasswordPage.jsx:36-44`) |

| ID | Case | Expected |
|---|---|---|
| `NEG-USR-32` | Token older than 1 hour | `400 INVALID_TOKEN`, message `Invalid or expired password reset token` (`auth.service.js:421-423`) |
| `NEG-USR-33` | Reused token | `400 INVALID_TOKEN`; token cleared on first success |
| `NEG-USR-34` | Password 7 chars | Client and API: `Password must be at least 8 characters` |
| `NEG-USR-35` | Reset while deactivated | `400 INVALID_TOKEN`; query filters `status: 'active'` |
| `NEG-USR-36` | Old password after reset | `401 Invalid credentials`; all refresh tokens marked used (`auth.service.js:437-439`) |

Reset tokens are single-use. The email link format is `FRONTEND_URL/reset-password?token=<64hex>` `[VERIFIED-CODE]` in `utils/email.js`; exact template path may vary `[UNVERIFIED-RUNTIME]`.

---

## 8. Screen: accept invite

Link format: `/accept-invite?token=<64hex>&email=<email>`.

Card title `Accept Invitation`; description `Set a password to activate your account for <email>.` (`AcceptInvitePage.jsx:62-65`).

| UI Label | API Field | Value to Enter | Input Type | Expected Result |
|---|---|---|---|---|
| New Password | `password` | `LotTrace!Invite2026` | Password, min 8 | Accepted |
| Activate Account | `token`, `email`, `password` | click | Button | `200`, message `Invitation accepted`; tokens issued; redirect `/dashboard` |

| ID | Case | Expected |
|---|---|---|
| `NEG-USR-37` | Missing `token` or `email` | Page shows `Invalid invitation link` (`AcceptInvitePage.jsx:46-57`) |
| `NEG-USR-38` | Expired invite (>72 h) | `400 INVALID_TOKEN`, message `Invalid or expired invitation` (`auth.service.js:456-458`) |
| `NEG-USR-39` | Wrong email for token | `400 INVALID_TOKEN`; lookup requires both |
| `NEG-USR-40` | Accept twice | `400 INVALID_TOKEN`; status no longer `invited` |
| `NEG-USR-41` | Password 7 chars | `Password must be at least 8 characters` |
| `NEG-USR-42` | Invite an email that already registered | `409 DUPLICATE_ENTRY`, message `This email is already registered to an existing LotTrace account` or `User is already in this organization` (`users.service.js:131-137`) |
| `NEG-USR-43` | Invite a deactivated user's email | `409 EMAIL_DEACTIVATED`, message depends on same/other org (`users.service.js:113-129`) |

---

## 9. Screen: `/settings/users` — Users & Roles

Heading `Users & Roles`; description `Manage users and roles in your organization.` (`UsersPage.jsx:247-249`).

### 9.1 List

Columns (`UsersPage.jsx:208-240`):

| UI Label | API Field | Type | Notes |
|---|---|---|---|
| First Name | `firstName` | text | Sortable? No sort UI; API supports sort |
| Last Name | `lastName` | text | — |
| Email | `email` | text | — |
| Role | `role` | badge/label | `Org Admin`, `Compliance Manager`, `Operator`, `Auditor` (`UsersPage.jsx:37-42`) |
| Status | `status` | badge | `Active`, `Invited`, `Deactivated` (`UsersPage.jsx:55-64`) |
| Actions | — | menu | Only when `users.manage` permission |

Visibility: `org_admin` sees actions. `compliance_manager` sees the list but no invite button and no row actions (`usePermissions`; `UsersPage.jsx:250-253`). `operator` and `auditor` do not see the page in the sidebar (`Sidebar.jsx`).

### 9.2 Invite User dialog

| UI Label | API Field | Value to Enter | Input Type | Expected Result |
|---|---|---|---|---|
| Email * | `email` | `oliver.grant@greenvalley.example.com` | Email | Accepted |
| First Name * | `firstName` | `Oliver` | Text, max 50 | Accepted |
| Last Name * | `lastName` | `Grant` | Text, max 50 | Accepted |
| Role * | `role` | `Operator` | Select; default `Operator` | Accepted |
| Cancel | — | click | Button | Dialog closes, form resets |
| Send Invite / Sending... | — | click | Button | `201`, message `User invited successfully`; row appears as Invited |

| ID | Case | Expected |
|---|---|---|
| `NEG-USR-44` | Invite with empty email | Client `Invalid email address` |
| `NEG-USR-45` | Invite with `role: "super_admin"` via API | `422`, message `Role must be one of: org_admin, compliance_manager, operator, auditor` |
| `NEG-USR-46` | Invite unknown extra field `organizationId` | `422`, `Unrecognized key(s) in object: 'organizationId'` (`.strict()`) |
| `NEG-USR-47` | `compliance_manager` calls invite | `403 AUTH_FORBIDDEN`, message `Insufficient permissions` |
| `NEG-USR-48` | Invite email already in same org | `409 DUPLICATE_ENTRY`, message `User is already in this organization` |
| `NEG-USR-49` | Invite email in another org | `409 DUPLICATE_ENTRY`, message `This email is already registered to an existing LotTrace account` |
| `NEG-USR-50` | Invite email of deactivated same-org user | `409 EMAIL_DEACTIVATED`, message `This user is deactivated. Reactivate the existing user instead of sending a new invite.` |
| `NEG-USR-51` | Invite email of deactivated other-org user | `409 EMAIL_DEACTIVATED`, message `This email belongs to a deactivated account. The owning organization must reactivate it before it can be invited again.` |

### 9.3 Edit Role dialog

| UI Label | API Field | Value to Enter | Input Type | Expected Result |
|---|---|---|---|---|
| Changing role for `<email>` | — | read-only text | Text | Shows target email |
| Role | `role` | `Compliance Manager` | Select | Accepted |
| Cancel | — | click | Button | No change |
| Save / Saving... | — | click | Button | `200`, message `User updated successfully`; badge changes |

| ID | Case | Expected |
|---|---|---|
| `NEG-USR-52` | Admin edits own role | Menu hides Edit Role for self (`UsersPage.jsx:54-60`). API returns `403 AUTH_FORBIDDEN`, message `Cannot change your own role` (`users.service.js:198-201`) |
| `NEG-USR-53` | Demote the only admin | `403 AUTH_FORBIDDEN`, message `Cannot demote the last organization admin` (`users.service.js:203-214`) |
| `NEG-USR-54` | Demote one of two admins | `200`; allowed |
| `NEG-USR-55` | Update with `{}` | `422`, message `No fields to update` (`users.service.js:221-223`) |
| `NEG-USR-56` | Update firstName to empty | `422`, field `firstName`, Zod min message `Too small: expected string to have >=1 characters` |
| `NEG-USR-57` | Update cross-tenant user | `404 NOT_FOUND`, message `User not found` |

### 9.4 Row actions

| Action | Shown for | Confirmation | API | Expected |
|---|---|---|---|---|
| Resend Invite | `invited` | None | `POST /users/:id/resend-invite` | `200`, message `Invite resent successfully`; new 72 h expiry |
| Cancel Invite | `invited`, not self | `Cancel invite?` → `Keep` / `Cancel Invite` | `POST /users/:id/deactivate` | `200`; user becomes `deactivated`, not deleted (`users.service.js:242-296`) |
| Edit Role | `active`, not self | Dialog | `PATCH /users/:id` | `200` |
| Deactivate | `active`, not self | `Deactivate user?` → `Cancel` / `Deactivate` | `POST /users/:id/deactivate` | `200`, message `User deactivated successfully`; user cannot log in |
| Reactivate | `deactivated` | None | `POST /users/:id/reactivate` | `200`; message `User reactivated successfully` or `Invitation sent successfully` if no password (`users.controller.js:34-39`) |
| Self row | current user | — | — | Disabled item `Cannot modify your own account` (`UsersPage.jsx:84-88`) |

| ID | Case | Expected |
|---|---|---|
| `NEG-USR-58` | Deactivate self via API | `403 AUTH_FORBIDDEN`, message `Cannot deactivate your own account` (`users.service.js:243-245`) |
| `NEG-USR-59` | Deactivate already deactivated | `409 CONFLICT`, message `User is already deactivated` (`users.service.js:255-257`) |
| `NEG-USR-60` | Deactivate last admin | `403 AUTH_FORBIDDEN`, message `Cannot deactivate the last organization admin` (`users.service.js:259-270`) |
| `NEG-USR-61` | Reactivate an active user | `409 CONFLICT`, message `Only deactivated users can be reactivated` (`users.service.js:314-316`) |
| `NEG-USR-62` | Resend invite for active user | `409 CONFLICT`; service requires `status='invited'` `[VERIFIED-CODE]` |
| `NEG-USR-63` | Cross-tenant deactivate | `404 User not found` |

### 9.5 List API filters

The UI sends only `page` and `limit` (`UsersPage.jsx:163`). The API supports these query parameters (`users.validation.js:19-26`):

| Query | Values | Example | Result |
|---|---|---|---|
| `page` | positive integer, default 1 | `?page=2` | Second page |
| `limit` | 1–100, default 20 | `?limit=5` | Five rows |
| `status` | `invited`, `active`, `deactivated` | `?status=invited` | Only invited |
| `role` | four roles plus `super_admin` | `?role=auditor` | Only auditors |
| `search` | max 100 chars | `?search=nair` | Matches first name, last name, or email, case-insensitive (`users.service.js:43-50`) |
| `sort` | `createdAt`, `firstName`, `lastName`, `email`, `role`, `status` | `?sort=email` | Sorted by field |
| `order` | `asc`, `desc`, default `desc` | `?order=asc` | Ascending |

Invalid `status` or `role` returns `422` with a Zod enum message. Invalid `sort` returns `422` listing the six allowed values.

---

## 10. PWA authentication and offline queue

| Rule | Value | Citation |
|---|---|---|
| No registration in PWA | Only login and resend verification | `scan-pwa/src/pages/auth/LoginPage.jsx` |
| Offline queue key | Scoped to organization and user | `scan-pwa/src/lib/outbox.js:9-28` |
| Retry policy | Retries 401, 408, 429; parks other 4xx | `scan-pwa/src/lib/outbox.js:37-42` |
| Duplicate scan suppression | 2 seconds per identical code | `scan-pwa/src/features/scanner/Scanner.jsx:86-101` |

PWA test users: `USR-005` and `USR-006` (operators). `USR-006` is the offline test account. Do not use an auditor in the PWA for event creation; the API returns `403`.

---

## 11. Audit events to expect

| Action | Entity | Expected audit row |
|---|---|---|
| Invite | user | `action` from `auditLogger('user')`, target user ID, actor admin |
| Role update | user | Before/after role |
| Deactivate | user | Before/after status |
| Reactivate | user | Before/after status |
| Resend invite | user | Metadata only; no token in audit |
| Login | — | No audit row; only `last_login_at` changes `[VERIFIED-CODE]` |
| Password reset | — | No audit row in current code `[VERIFIED-CODE]` |

Passwords and token hashes must never appear in `before_state` or `after_state`. The audit service redacts `password`, `passwordHash`, `password_hash`, `token`, and `tokenHash` keys (`audit.service.js:13-31`). Verify by opening the audit log after an invite.

---

## 12. Cleanup

- Invited users that are no longer needed: use Cancel Invite (deactivate), not delete.
- Do not re-invite a deactivated email into another organization; reactivate it in its owner organization first.
- To reset auth state without dropping data: `redis-cli FLUSHDB` clears signup, reset, deny, blacklist, rate-limit, and trace cache. It does not clear database rows.
