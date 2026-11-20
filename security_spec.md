# SOTAL Study Security Specification (Phase 0: Payload-First Security TDD)

## 1. Data Invariants
1. **Strict User Isolation (PII & Academic Data)**: Every document under `/users/{userId}` and all nested subcollections (`courses`, `topics`, `sources`, `conversations`, `messages`, `studyMaterials`, `studySessions`, `segments`, `checkpoints`, `studyHistory`) is strictly private to `request.auth.uid == userId` with `request.auth.token.email_verified == true`. No cross-user read, list, create, update, or delete is ever permitted.
2. **No Secrets in Cloud**: Gemini API keys are strictly forbidden in Firestore schemas; unknown/shadow fields are rejected by `hasOnly(...)` validation blueprints.
3. **Parent Integrity (Master Gate)**:
   - A `Topic`, `StudySource`, `TutorConversation`, `SavedStudyMaterial`, `AutomaticStudySession`, or `StudyHistoryRecord` cannot be created unless its parent `Course` exists at `/users/{userId}/courses/{courseId}` and `incoming().courseId == courseId`.
   - A `TutorMessage` cannot be created unless its parent `TutorConversation` exists and `incoming().conversationId == conversationId`.
   - A `StudySessionSegment` or `StudySessionCheckpoint` cannot be created unless its parent `AutomaticStudySession` exists and `incoming().sessionId == sessionId`.
4. **Immutable Ownership & Creation Timestamps**: `userId`, `courseId`, `conversationId`, `sessionId`, and `createdAt` can never be mutated on update. Server timestamps (`request.time`) are mandatory for `createdAt` on create and `updatedAt` on update.
5. **Terminal State Locking**: Once an `AutomaticStudySession` or `StudyHistoryRecord` reaches `status == 'completed'`, further state mutations are blocked.
6. **Volumetric & ID Hardening**: All single-document path IDs must match `^[a-zA-Z0-9_\-]+$` (length <= 128). Every string and array field enforces explicit upper `.size()` bounds.

## 2. The "Dirty Dozen" Attack Payloads
1. **Cross-User Profile Read (PII Leak)**: User B attempts `get` on `/users/userA`. Must return `PERMISSION_DENIED`.
2. **Unverified Email Write**: User A with `email_verified: false` attempts `create` on `/users/userA/courses/c1`. Must return `PERMISSION_DENIED`.
3. **Identity Spoofing on Create**: User A attempts to create `/users/userA/courses/c1` with `{ userId: "userB", ... }`. Must return `PERMISSION_DENIED`.
4. **Shadow Field Injection (API Key / Ghost Field)**: User A creates or updates a `UserProfile` or `Course` with an extra `{ geminiApiKey: "AIza...", isAdmin: true }`. Must return `PERMISSION_DENIED`.
5. **Orphaned Topic Creation**: User A creates `/users/userA/courses/nonexistent/topics/t1` where course `nonexistent` does not exist. Must return `PERMISSION_DENIED`.
6. **ID Poisoning**: User A attempts `create` on `/users/userA/courses/bad$id!with*symbols`. Must return `PERMISSION_DENIED`.
7. **Client Timestamp Forgery**: User A creates a course with a backdated `createdAt` instead of `serverTimestamp()`. Must return `PERMISSION_DENIED`.
8. **Immutable Field Tampering**: User A updates a `Course` attempting to modify `createdAt` or `userId`. Must return `PERMISSION_DENIED`.
9. **Resource Poisoning (Oversized String)**: User A creates a `Course` with a 10,000-character `name` (exceeding 120 char limit). Must return `PERMISSION_DENIED`.
10. **Terminal State Violation**: User A attempts to update an `AutomaticStudySession` whose `existing().status == 'completed'` back to `'active'`. Must return `PERMISSION_DENIED`.
11. **Value Poisoning on Whitelisted Update Field**: User A updates `Course.name` to a boolean `true` instead of a bounded string. Must return `PERMISSION_DENIED`.
12. **Cross-User List Scraping**: User B attempts `list` on `/users/userA/courses`. Must return `PERMISSION_DENIED`.
