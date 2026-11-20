# 20 — Auth, Users, Roles, and Permissions

> Screens: `/login`, `/register`, `/verify-email`, `/forgot-password`, `/reset-password`, `/accept-invite`, `/settings/users`.
> API: `/api/v1/auth/*`, `/api/v1/users/*`.

This file covers identity and access. Field-by-field user records live in `11_users_auth.md`; role fixtures live in `03_design_notes.md`.

---

## 1. Roles

| Role | Scope | Can log in | Created by | Notes |
|---|---|---|---|---|
| `org_admin` | One organization | Yes | Registration OTP or invite | At least one non-deactivated admin per org |
| `compliance_manager` | One organization | Yes | Invite | Full traceability, no user admin |
| `operator` | One organization | Yes | Invite | Records lots/events, read-only elsewhere |
| `auditor` | One organization | Yes | Invite | Read-only, including audit log |
| `api_key` | Organization via key | No password login | API key management (not built) | Not issued by any mounted route |
| `super_admin` | Platform | Yes, if a user row exists | Seed/DB only | `rbac` bypass; still needs `organizationId` for tenant routes |

The invite API accepts only the first four (`users/users.validation.js:4-11`). `api_key` is a role value in the schema and UI permission map, but no route creates an API-key principal. `super_admin` is accepted by the user list filter (`users.validation.js:22`) and bypasses `rbac` (`rbac.js:13`).

Seed super admin: `USR-000` in `03_design_notes.md`. Its JWT must include an `orgId` for `tenantScope`; the seeded row may lack one. `[UNVERIFIED-RUNTIME]`

---

## 2. Auth API surface

All routes mount under `/api/v1/auth` and pass through `authLimiter` (`auth.routes.js:9`).

| Method | Path | Body | Success | Message |
|---|---|---|---|---|
| POST | `/register` | `firstName`, `lastName`, `email`, `password`, `organizationName` | `201` | `Registration successful. Please check your email for a verification code.` |
| POST | `/login` | `email`, `password` | `200` | `Login successful` |
| POST | `/verify-email` | `email`, `otp` | `200` | `Email verified successfully` |
| POST | `/resend-verification` | `email` | `200` | `If that email is pending verification, a new code has been sent.` |
| POST | `/refresh` | — (cookie `refreshToken`) | `200` | `Token refreshed` |
| POST | `/logout` | — (cookie + bearer) | `200` | `Logged out successfully` |
| POST | `/forgot-password` | `email` | `200` | `If that email exists, a reset link has been sent` |
| POST | `/reset-password` | `token`, `newPassword` | `200` | `Password reset successfully` |
| POST | `/accept-invite` | `token`, `email`, `password` | `200` | `Invitation accepted` |

Citations: `auth/auth.routes.js:11-19`; `auth/auth.controller.js:18-83`.

`refreshToken` is returned only as an httpOnly cookie named `refreshToken`; the JSON body contains `user` and `accessToken` (`auth.controller.js:6-16,24-29`). In development the cookie is `SameSite=Lax` and not `Secure`; in production it is `SameSite=None; Secure` (`auth.controller.js:10-13`).

---

## 3. Token and session rules

| Rule | Value | Citation |
|---|---|---|
| Access token TTL | 30 minutes | `auth/auth.service.js:58-63` |
| Access token claims | `sub`, `orgId`, `role` | `auth/auth.service.js:60` |
| Refresh token | 32 random bytes, hex, stored as SHA-256 hash | `auth/auth.service.js:65-72` |
| Refresh token TTL | 7 days | `auth/auth.service.js:71`; `20240101000002_create_users.js` refresh table |
| Refresh rotation | Old token marked used; replacement inserted | `auth/auth.service.js:332-353` |
| Reuse grace window | 10 seconds returns the replacement token | `auth/auth.service.js:13,311-325` |
| Reuse outside grace | Deletes the whole session family; `401 TOKEN_REUSE` | `auth/auth.service.js:327-329,361-363` |
| Logout | Marks refresh token used; blacklists access token in Redis until expiry | `auth/auth.service.js:369-385` |
| Blacklist key | `bl_<accessToken>` | `auth/auth.service.js:379` |
| Deactivation deny key | `du_<userId>`, 31 minutes | `users/users.service.js:10-12,272-273` |
| Auth failure when Redis is down | `503 AUTH_UNAVAILABLE`, `Retry-After: 5` | `middleware/authenticate.js:19-35,51-67` |
| Revoked token | `401 AUTH_SESSION_REVOKED`, `Token has been revoked` | `authenticate.js:37-39,69-71` |
| Invalid/expired access token | `401 AUTH_TOKEN_EXPIRED`, `Token is invalid or expired` | `authenticate.js:41-46` |
| Missing bearer | `401 AUTH_REQUIRED`, `Missing or invalid authorization header` | `authenticate.js:9-12` |

The error code for an expired access token is `AUTH_TOKEN_EXPIRED` even when the token is malformed. The message is always `Token is invalid or expired`.

The JWT is not re-fetched per request. Role changes take effect only when a new access token is issued, contrary to `docs/RBAC.md:151` claiming immediate effect. The deactivation deny key closes the gap for deactivation only. Finding.

---

## 4. Screen: `/register`

Card `Create Organization`; description `Setup your new LotTrace account` (`RegisterPage.jsx:40-43`).

| UI Label | API Field | Value to Enter | Input Type/How to Enter | Expected Result |
|---|---|---|---|---|
| Organization Name * | `organizationName` | `Cedar Fork Test Kitchen` | Text, placeholder `Company LLC` | Accepted; org created after OTP |
| First Name * | `firstName` | `Nora` | Text | Accepted; max 50 server-side |
| Last Name * | `lastName` | `Feld` | Text | Accepted; max 50 |
| Work Email * | `email` | `nora.feld@cedar-fork.example.org` | Email | Lowercased; must be globally unique |
| Password * | `password` | `Cedar!Fork2026` | Password | Min 8; no other composition rule |
| Register | — | click | Button | `201`; navigate to `/verify-email` |

Client errors use the messages in `RegisterPage.jsx:13-19`. Server errors override with the API message.

### 4.1 Registration behavior

1. Look up email under `app.auth_email`. If found and `status='invited'`, return `409 EMAIL_INVITED`; otherwise `400 EMAIL_IN_USE` (`auth.service.js:77-96`).
2. Hash the password with Argon2id (`auth.service.js:98`).
3. Generate a 6-digit OTP and SHA-256 hash it (`auth.service.js:45-56,100-103`).
4. Store the whole pending signup in Redis key `signup:<email>` with a 30-minute TTL (`auth.service.js:113-118`).
5. Queue the `verification_otp` email (`auth.service.js:121-124`).
6. Return `{ requiresVerification: true, email }`; **no tokens** and no database user (`auth.service.js:126-130`).

No user or organization row exists until OTP verification. Do not look for the email in `users` before verifying.

### 4.2 Registration negatives

| ID | Input | Expected |
|---|---|---|
| `NEG-AUTH-01` | Missing first name | `422`, field `firstName`, `First name is required` |
| `NEG-AUTH-02` | First name 51 chars | `422`, field `firstName`, max 50 |
| `NEG-AUTH-03` | Bad email `not-an-email` | `422`, field `email`, `Invalid email address` |
| `NEG-AUTH-04` | Password 7 chars | `422`, field `password`, `Password must be at least 8 characters` |
| `NEG-AUTH-05` | Empty organization | `422`, field `organizationName`, `Organization name is required` |
| `NEG-AUTH-06` | Existing active email | `400`, code `EMAIL_IN_USE`, message `Email already in use` |
| `NEG-AUTH-07` | Email with pending invite | `409`, code `EMAIL_INVITED`, message `This email has a pending invitation. Accept the invitation from your inbox to continue.` |
| `NEG-AUTH-08` | Deactivated email | `400`, code `EMAIL_IN_USE`; registration does not distinguish |
| `NEG-AUTH-09` | Uppercase email | Accepted; stored lowercased |
| `NEG-AUTH-10` | 51 requests from one email+IP in 15 minutes | `429`, `Too many authentication attempts, please try again later.` |
| `NEG-AUTH-11` | Same email registered twice before OTP | Second call overwrites the Redis payload; both OTPs become invalid except the last `[VERIFIED-CODE]` |

`NEG-AUTH-11` is a behavior check, not a supported flow. Document the last OTP only.

---

## 5. Screen: `/verify-email`

Card `Verify your email`; text `We sent a 6-digit code to <email>` (`VerifyEmailPage.jsx:169-179`).

| Control | Rule |
|---|---|
| Six single-digit inputs | Only digits; auto-advance; Backspace moves back |
| Auto-submit | Fires when the sixth digit is entered |
| Paste | Strips non-digits, fills inputs, auto-submits on 6 digits |
| Resend code | 60-second client cooldown; server may return `429 RATE_LIMITED` |
| No email in state | Redirect to `/register` |

Citations: `VerifyEmailPage.jsx:26-149,183-200`.

| ID | Case | Expected |
|---|---|---|
| `AUTH-V01` | Correct OTP within 30 min | `200`; user + org created; tokens set; `Email Verified!`; redirect to `/dashboard` |
| `AUTH-V02` | Wrong OTP | `400`, `Invalid verification code`, code `INVALID_VERIFICATION_CODE`; inputs clear |
| `AUTH-V03` | Expired OTP (after 30 min) | `400`, `Invalid or expired verification code` |
| `AUTH-V04` | Resend before 2 minutes | `429`, `Please wait before requesting a new verification code.`, code `RATE_LIMITED` |
| `AUTH-V05` | Resend after 2 minutes | `200`; new OTP; TTL reset to 15 minutes |
| `AUTH-V06` | Unknown email | `400`, `Invalid or expired verification code` |
| `AUTH-V07` | OTP with letters | `422`, field `otp`, `OTP must be 6 digits` |
| `AUTH-V08` | OTP 5 digits | `422`, field `otp`, `OTP must be exactly 6 digits` |
| `AUTH-V09` | Direct `/verify-email` visit | Redirects to `/register` |
| `AUTH-V10` | Check DB before verify | No `users` or `organizations` row |

Note the resend TTL math: the code sets 1800 seconds initially but the rate-limit comparison uses `ttl > 780` with a comment describing a 900-second TTL (`auth.service.js:256-266`). The practical block is about 17 minutes, not 2 minutes, for the first signup. Finding. Verify actual behavior.

---

## 6. Screen: `/login`

Card `Welcome back`; description `Login to your LotTrace account` (`LoginPage.jsx:64-69`).

| UI Label | API Field | Value to Enter | Expected |
|---|---|---|---|
| Email * | `email` | `ava.thompson@greenvalley.example.com` | Accepted |
| Password * | `password` | `LotTrace!Test2026` | Accepted |
| Sign In | — | click | `200`; navigate to `/dashboard` |
| Forgot your password? | — | link | `/forgot-password` |
| Create account | — | link | `/register` |

Client errors: `Invalid email address`, `Password is required` (`LoginPage.jsx:15-18`).

| ID | Case | Expected |
|---|---|---|
| `AUTH-L01` | Valid active user | `200`; `last_login_at` updated; refresh cookie set |
| `AUTH-L02` | Wrong password | `401`, `Invalid credentials`, code `INVALID_CREDENTIALS` |
| `AUTH-L03` | Unknown email | Same `401`, same message; no enumeration |
| `AUTH-L04` | Invited user before accepting | `401 Invalid credentials`; no password hash |
| `AUTH-L05` | Deactivated user | `401 Invalid credentials` |
| `AUTH-L06` | Pending signup (not verified) | `401 Invalid credentials`; **no** `EMAIL_NOT_VERIFIED` code exists anymore |
| `AUTH-L07` | Empty email | `422`, `Invalid email address` |
| `AUTH-L08` | Empty password | `422`, `Password is required` |
| `AUTH-L09` | 51 login attempts | `429` from `authLimiter` |
| `AUTH-L10` | Access token after deactivation | `401 AUTH_SESSION_REVOKED` |

`LoginPage` still handles a `EMAIL_NOT_VERIFIED` error and shows a resend panel (`LoginPage.jsx:37-98`). No backend path emits that code: pending users live only in Redis and login returns `INVALID_CREDENTIALS`. The panel is dead UI. Finding.

---

## 7. Password reset

### 7.1 `/forgot-password`

Card `Reset Password`; description `Enter your email to receive a password reset link.` (`ForgotPasswordPage.jsx:32-36`).

| Field | Value | Expected |
|---|---|---|
| Email * | `priya.nair@greenvalley.example.com` | `200`; toast `Reset link sent to your email.`; success panel |
| Send Reset Link | — | Button |

| ID | Case | Expected |
|---|---|---|
| `AUTH-P01` | Known active email | `200`, generic message; reset token hash and 1-hour expiry stored (`auth.service.js:386-410`) |
| `AUTH-P02` | Unknown email | `200`, same generic message; no email |
| `AUTH-P03` | Invited user | `200`, generic; no email because status is not `active` |
| `AUTH-P04` | Bad email format | `422`, `Invalid email address` |

### 7.2 `/reset-password?token=...`

Card `Set New Password`; description `Enter your new password below.` (`ResetPasswordPage.jsx:47-51`).

| Field | Value | Expected |
|---|---|---|
| New Password * | `GreenValley!2026b` | Min 8; accepted |
| Reset Password | — | `200`; toast; redirect `/login` |
| Missing token | — | `Invalid or missing reset token.` |

| ID | Case | Expected |
|---|---|---|
| `AUTH-P05` | Valid token, new password | `200`; all refresh tokens marked used; old sessions die |
| `AUTH-P06` | Token reused | `400`, `Invalid or expired password reset token`, code `INVALID_TOKEN` |
| `AUTH-P07` | Token after 1 hour | Same `400` |
| `AUTH-P08` | Password 7 chars | `422`, `Password must be at least 8 characters` |
| `AUTH-P09` | Empty token | `422`, `Token is required` |
| `AUTH-P10` | Deactivated user token | `400`, invalid token |

Reset does not clear the `du_` deny key and does not reactivate the user. A deactivated user stays blocked.

---

## 8. Screen: `/accept-invite`

Card `Accept Invitation`; description `Set a password to activate your account for <email>.` (`AcceptInvitePage.jsx:59-65`).

| Field | Value | Expected |
|---|---|---|
| New Password * | `Operator!2026` | Min 8; accepted |
| Activate Account | — | `200`; tokens set; navigate `/dashboard` |

The URL must contain `token` and `email`: `/accept-invite?token=<hex>&email=<urlencoded>`. Missing either shows `Invalid invitation link` (`AcceptInvitePage.jsx:46-57`).

| ID | Case | Expected |
|---|---|---|
| `AUTH-I01` | Valid token, matching email | `200`; status `active`; invite fields cleared; tokens set |
| `AUTH-I02` | Token after 72 hours | `400`, `Invalid or expired invitation`, code `INVALID_TOKEN` |
| `AUTH-I03` | Token already used | `400`, same |
| `AUTH-I04` | Wrong email with valid token | `400`, same |
| `AUTH-I05` | Password 7 chars | `422`, `Password must be at least 8 characters` |
| `AUTH-I06` | Missing token | Client shows invalid link; API would `422`, `Token is required` |
| `AUTH-I07` | Missing email | Client invalid link; API `422`, `Invalid email address` |
| `AUTH-I08` | Invite resent, old link used | `400`; only the latest token hash matches |

Accepting an invite does not update `role`; the invited role is preserved.

---

## 9. Users settings page

Header `Users & Roles`; description `Manage users and roles in your organization.` (`UsersPage.jsx:247-248`).

The page has **no search box, no status filter, no role filter, and no column sort control**. It renders the default `created_at desc` list with `limit: 10` and a pager (`UsersPage.jsx:163-169,360-365`). The filter and sort capabilities exist only in the API (`users/users.validation.js:19-26`); test them with a REST client.

| Control | Roles | API |
|---|---|---|
| Pager only | admin/compliance | `GET /users?page=&limit=` |
| Search (API only) | admin/compliance | `GET /users?search=` matches first name, last name, email |
| Status filter (API only) | admin/compliance | `invited`, `active`, `deactivated` |
| Role filter (API only) | admin/compliance | four org roles plus `super_admin` |
| Sort (API only) | admin/compliance | `createdAt`, `firstName`, `lastName`, `email`, `role`, `status`; `asc`/`desc` |
| Invite User | admin only | `POST /users/invite` |
| Edit role | admin only | `PATCH /users/:userId` |
| Deactivate / Reactivate | admin only | `POST /users/:userId/deactivate` / `reactivate` |
| Resend invite | admin only | `POST /users/:userId/resend-invite` |

Citations: `users/users.validation.js:19-26`; `users/users.routes.js:15-66`; `UsersPage.jsx:163-169,213-240,360-365`.

### 9.1 Invite rules

| Rule | Value | Citation |
|---|---|---|
| Email global uniqueness | One email belongs to one org | `20260702172631_enforce_global_unique_email.js:15` |
| Invite TTL | 72 hours | `users/users.service.js:140-143` |
| Same-org duplicate | `409 DUPLICATE_ENTRY`, `User is already in this organization` | `users/users.service.js:131-137` |
| Cross-org duplicate | `409 DUPLICATE_ENTRY`, `This email is already registered to an existing LotTrace account` | `users/users.service.js:131-137` |
| Deactivated same org | `409 EMAIL_DEACTIVATED`, `This user is deactivated. Reactivate the existing user instead of sending a new invite.` | `users/users.service.js:113-129` |
| Deactivated other org | `409 EMAIL_DEACTIVATED`, `This email belongs to a deactivated account. The owning organization must reactivate it before it can be invited again.` | `users/users.service.js:113-129` |
| Invited user login | No password hash until accept | `auth.service.js:138-140` |

### 9.2 Update and deactivation rules

| Rule | Error | Citation |
|---|---|---|
| Self role change | `403`, `Cannot change your own role`, code `AUTH_FORBIDDEN` | `users/users.service.js:198-201` |
| Demote last admin | `403`, `Cannot demote the last organization admin` | `users/users.service.js:203-214` |
| Empty update | `422`, `No fields to update`, code `VALIDATION_ERROR` | `users/users.service.js:221-223` |
| Self deactivate | `403`, `Cannot deactivate your own account` | `users/users.service.js:242-245` |
| Deactivate last admin | `403`, `Cannot deactivate the last organization admin` | `users/users.service.js:259-270` |
| Already deactivated | `409`, `User is already deactivated`, code `CONFLICT` | `users/users.service.js:255-257` |
| Reactivate non-deactivated | `409`, `Only deactivated users can be reactivated` | `users/users.service.js:315-319` |
| Resend non-invited | `409`, `Only pending invitations can be resent` | `users/users.service.js:385-391` |

Deactivation writes the `du_` deny key for 31 minutes, marks all refresh tokens used, and keeps the password hash. Reactivation clears the deny key and returns the user to `active` if a password exists, else to `invited` with a fresh 72-hour token (`users/users.service.js:242-296,298-353`).

`UsersPage` shows the list to `compliance_manager` but only `org_admin` gets `Invite User`, role editing, deactivation, and resend actions (`UsersPage.jsx:228-250`; `usePermissions.js` grants compliance only `users.read`). The API allows `compliance_manager` to list and view users, and denies every user mutation to that role.

---

## 10. Route-level role matrix

This is the authoritative backend matrix from the mounted routes.

| Route | admin | compliance | operator | auditor |
|---|---|---|---|---|
| `GET /organizations/me` | 200 | 200 | 200 | 200 |
| `PATCH /organizations/me` | 200 | 403 | 403 | 403 |
| `GET /users`, `GET /users/:id` | 200 | 200 | 403 | 403 |
| `POST /users/invite` | 201 | 403 | 403 | 403 |
| `PATCH /users/:id` | 200 | 403 | 403 | 403 |
| Deactivate/reactivate/resend | 200 | 403 | 403 | 403 |
| `GET /locations`, `GET /locations/:id` | 200 | 200 | 200 | 200 |
| `POST /locations` | 201 | 201 | 201 | 403 |
| `PATCH /locations/:id` | 200 | 200 | 403 | 403 |
| `POST /locations/:id/deactivate` | 200 | 403 | 403 | 403 |
| `GET /products`, `GET /products/:id` | 200 | 200 | 200 | 200 |
| `POST /products` | 201 | 201 | 403 | 403 |
| `PATCH /products/:id` | 200 | 200 | 403 | 403 |
| `GET /lots`, `GET /lots/:id` | 200 | 200 | 200 | 200 |
| `POST /lots` | 201 | 201 | 201 | 403 |
| `PATCH /lots/:id` | 200 | 200 | 200 | 403 |
| `POST /lots/:id/void` | 200 | 200 | 403 | 403 |
| `GET /events`, `/events/:id`, `/events/:id/attachments` | 200 | 200 | 200 | 200 |
| `POST /events` | 201 | 201 | 201 | 403 |
| `POST /events/:id/void`, `/amend` | 200 | 200 | 403 | 403 |
| `POST /events/:id/attachments/*` | 201 | 201 | 201 | 403 |
| `GET /events/:id/attachments` | 200 | 200 | 200 | 200 |
| `GET /attachments/:id/download` | 200 | 200 | 200 | 200 |
| `DELETE /attachments/:id` | 200 | 200 | 403 | 403 |
| `GET /trace/*` | 200 | 200 | 200 | 200 |
| `GET /reports/compliance-gaps` | 200 | 200 | 200 | 200 |
| `POST /reports/export` | 202 | 202 | 403 | 403 |
| `GET /reports/exports/:id`, `/download` | 200 | 200 | 403 | 403 |
| `GET /audit` | 200 | 200 | 403 | 200 |
| `GET /imports`, `/imports/:id`, `/errors`, `/template` | 200 | 200 | 200 | 200 |
| `POST /imports` | 201 | 201 | 201 | 403 |
| `POST /recall` | 201 | 201 | 403 | 403 |
| `GET /recall`, `/recall/:id` | 200 | 200 | 403 | 200 |
| `GET /dashboard/stats`, `/activity` | 200 | 200 | 200 | 200 |
| `GET /notifications` | 200 | 200 | 200 | 200 |
| `PATCH /notifications/:id/read`, `/read-all` | 200 | 200 | 200 | 200 |

Sources: `organizations.routes.js:12-18`; `users.routes.js:13-66`; `locations.routes.js:12-41`; `products.routes.js:12-35`; `lots.routes.js:12-42`; `events.routes.js:21-84`; `app.js:98-112`; `trace.routes.js:11-33`; `reports.routes.js:12-46`; `audit.routes.js:11-19`; `imports/routes.js:25-55`; `recall/routes.js:10-30`; `dashboard/routes.js:8-20`; `notifications.routes.js:11-30`.

Every denial body is:

```json
{
  "success": false,
  "message": "Insufficient permissions to access this resource",
  "error": { "code": "AUTH_FORBIDDEN" }
}
```

`super_admin` passes every `rbac` check (`rbac.js:13`). Verify tenant scope separately.

### 10.1 UI permission map vs backend

`frontend/src/hooks/usePermissions.js:3-43` is a separate hard-coded map. Divergences that change what a tester sees:

| Permission | UI grants | Backend grants | Effect |
|---|---|---|---|
| `locations.create` | compliance_manager | compliance_manager + operator | UI hides `Add Location` from operators, API allows it |
| `locations.update` | compliance_manager | compliance_manager (operator blocked) | Match |
| `reports.export` | compliance_manager | compliance_manager | Match |
| `imports.*` | compliance_manager | compliance_manager | Match |
| `recall.*` | compliance_manager | compliance_manager | Match |
| `users.read` | compliance_manager | compliance_manager | Match; sidebar may still hide Settings |
| `lots.*` | compliance_manager | compliance_manager | Match, but UI hides Void Lot from compliance in lot detail (see `14_lots.md`) |
| `settings.read` | compliance_manager | organization GET only | Page may open, PATCH is admin-only |
| `audit.read` | operator false, auditor true | same | Match |

The operator role is the notable mismatch: the API allows `POST /locations`, while `usePermissions.js` grants operators no `locations.create` and the list page hides `Add Location` (`LocationsListPage.jsx:206`). Lot editing is **not** a mismatch: `LotDetailPage.jsx:128` gates the menu on `events.create`, which operators have, and `PATCH /lots/:id` allows operators too.

`docs/RBAC.md:25-77` differs again: it says operators cannot create locations and auditors cannot view imports, while both are allowed by code. It also says exports are available to auditors (`docs/RBAC.md:55`), while code returns `403`. Treat code as authoritative; findings go in `99_discrepancies_and_findings.md`.

---

## 11. Rate limits

| Limiter | Scope | Limit / window | Response |
|---|---|---|---|
| `authLimiter` | All `/auth/*`, keyed by email or token or IP | 50 / 15 min | `429`, `Too many authentication attempts, please try again later.` |
| `apiLimiter` | All `/api`, keyed by IP | 1000 / 15 min | `429`, `Too many requests, please try again later.` |
| `userLimiter` | Authenticated, keyed by user id | 1000 / 15 min | `429`, same |
| `exportLimiter` | Export creation, keyed by org | 10 / 15 min | `429`, `Too many export requests, please try again later.` |

Citations: `middleware/rateLimiter.js:69-134`. All limiters `passOnStoreError: true`, so a Redis outage does not block traffic at the limiter layer.

---

## 12. Security checks for testers

| ID | Check | Expected |
|---|---|---|
| `SEC-01` | Login response body contains no `password_hash`, `invite_token_hash`, or reset token | Only `user`, `accessToken` |
| `SEC-02` | `GET /users` response excludes `password_hash` | Yes (`users/users.service.js:54-56,361-373`) |
| `SEC-03` | Cross-tenant `GET /users/:id` with another org's id | `404 User not found` |
| `SEC-04` | Cross-tenant invite of an existing email | `409 DUPLICATE_ENTRY`, cross-org message |
| `SEC-05` | Deactivated user's existing access token | Rejected within one request; `401 AUTH_SESSION_REVOKED` |
| `SEC-06` | Logout, then reuse access token | `401 AUTH_SESSION_REVOKED` |
| `SEC-07` | Refresh token reuse after 10 seconds | `401 TOKEN_REUSE`; session family deleted |
| `SEC-08` | Refresh with no cookie | `401 AUTH_INVALID_REFRESH`, `Refresh token required` |
| `SEC-09` | `PATCH /organizations/me` as compliance | `403` |
| `SEC-10` | `GET /audit` as operator | `403` |
| `SEC-11` | Change own role as admin | `403`, `Cannot change your own role` |
| `SEC-12` | Deactivate the only admin | `403`, `Cannot deactivate the last organization admin` |
| `SEC-13` | Confirm password policy | Only min 8; `abcdefgh` is accepted. Finding against `docs/PRD.md` if it claims complexity |
| `SEC-14` | Confirm email verification is Redis-only | No `email_verified` column; expired Redis key loses the signup |
| `SEC-15` | Refresh endpoint CSRF surface | `SameSite=Lax` in dev; cross-site POST may be blocked by the browser `[UNVERIFIED-RUNTIME]` |

---

## 13. Audit coverage of auth events

| Event | Audit row? | Citation |
|---|---|---|
| Register | No | `auth.routes.js` has no `auditLogger` |
| OTP verify | No | same |
| Login | No | same |
| Logout | No | same |
| Password reset | No | same |
| Invite user | Yes, `user.invite` | `users.routes.js:24-30` |
| Role change | Yes, but action is `user.patch` | `users.routes.js:35-42`; `auditLogger.js:21` |
| Deactivate | Yes, `user.deactivate` | `users.routes.js:44-50` |
| Reactivate | Yes, `user.reactivate` | `users.routes.js:52-58` |
| Resend invite | Yes, `user.resend_invite` | `users.routes.js:60-66` |

Login/logout/reset are absent from the audit log. If `docs/PRD.md` requires authentication auditing, this is a gap.

---

## 14. Auth fixture checklist

Use users from `03_design_notes.md`. Minimum set per organization:

| Org | admin | compliance | operator | auditor |
|---|---|---|---|---|
| ORG-001 | USR-001, USR-002 | USR-003, USR-004 | USR-005, USR-006 | USR-008 |
| ORG-002 | USR-011 | USR-012 | USR-013, USR-014 | USR-015 |
| ORG-003 | USR-017 | USR-018 | USR-019, USR-020 | USR-021 |
| ORG-004 | USR-023 | USR-024 | USR-025 | USR-026 |
| ORG-005 | USR-028 | USR-029 | USR-030 | USR-031 |
| ORG-006 | USR-033 | — | — | — |

`USR-000` is the platform `super_admin`. `USR-016`, `USR-027`, and every invited/deactivated user are deliberate state fixtures, not coverage gaps. All four roles exist in every active organization except ORG-006, which has one admin.

All active users use `LotTrace!Test2026` unless `11_users_auth.md` says otherwise. Invited users have no password. Deactivated users keep their old password but cannot log in.

---

## 15. Cleanup

| Action | Cleanup |
|---|---|
| Register without verifying | Wait 30 minutes or `redis-cli DEL signup:<email>` |
| Invited user | Cannot cancel; reset the DB or leave the invite |
| Deactivated user | Reactivate or reset the DB |
| Sessions | `POST /auth/logout`; or `redis-cli FLUSHDB` to clear blacklist/deny keys |
| Rate limits | `redis-cli --scan --pattern 'rl:*' | xargs redis-cli DEL` |
| Users/orgs | No delete API; reset the disposable database |
