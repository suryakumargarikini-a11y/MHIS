# Security Specification (SIH25083 Migrant Health Intelligence System)

## Data Invariants
1. Every document ID must match `^[a-zA-Z0-9_\-]+$` and stay <= 128 chars, and `healthId`/`encounterId`/`logId`/`uid` inside payloads must match the document path ID.
2. Users cannot self-assign `doctor` or `admin` privileges on `/users/{userId}` create, and non-admins cannot mutate `role` on `/users/{userId}` update.
3. Every `patients`, `encounters`, `consents`, and `auditLogs` document created by an authenticated user must have `ownerUid == request.auth.uid`.
4. `encounters` are immutable append-only records created only by verified `doctor` or `admin` accounts for an existing parent patient document.
5. `auditLogs` are strictly append-only: `update` and `delete` are denied for all users.
6. All `create` and `update` operations enforce exact `hasAll` and `hasOnly` key allowlists, field size bounds, and server `request.time` timestamps.

## Dirty Dozen Adversarial Payloads (Expected: PERMISSION_DENIED)
1. Unauthenticated read/write to `/patients/MHIS-01`
2. Unauthenticated list on `/auditLogs`
3. User creating `/users/{uid}` with `role: "admin"` or `role: "doctor"`
4. Authenticated `patient` updating `/users/{uid}` to elevate `role: "doctor"`
5. User creating `/patients/MHIS-99` with `ownerUid` set to another user's UID
6. User updating `/patients/MHIS-01` with shadow ghost field `isVerified: true`
7. User updating immutable `createdAt` or `ownerUid` on `/patients/MHIS-01`
8. User updating or deleting `/auditLogs/log-1`
9. Patient role creating `/patients/MHIS-01/encounters/enc-1` directly without clinician/admin role
10. User injecting a 2KB string into `fullName` (exceeds maxLength 120) or invalid path ID containing `/`
11. Non-owner reading another user's `/consents/{healthId}` or `/patients/{patientId}`
12. Email spoofing without `email_verified == true` claiming admin status
