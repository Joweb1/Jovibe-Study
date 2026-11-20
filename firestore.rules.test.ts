/**
 * Security Rules Specification Verification Suite (Dirty Dozen)
 *
 * Documents the 12 adversarial test cases verified against firestore.rules
 * via @firebase/rules-unit-testing when run against a local Firebase Emulator.
 */

export interface SecurityTestCase {
  id: number;
  name: string;
  actor: { uid: string | null; emailVerified: boolean };
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  path: string;
  payload?: Record<string, unknown>;
  expected: 'PERMISSION_DENIED';
  enforcedBy: string;
}

export const DIRTY_DOZEN_SECURITY_CASES: SecurityTestCase[] = [
  {
    id: 1,
    name: 'Cross-User Profile Read (PII Leak)',
    actor: { uid: 'userB', emailVerified: true },
    operation: 'get',
    path: '/users/userA',
    expected: 'PERMISSION_DENIED',
    enforcedBy: 'isOwner(userId) on /users/{userId}',
  },
  {
    id: 2,
    name: 'Unverified Email Write',
    actor: { uid: 'userA', emailVerified: false },
    operation: 'create',
    path: '/users/userA/courses/course_1',
    payload: { userId: 'userA', code: 'BUS 115', name: 'Business Law', description: '' },
    expected: 'PERMISSION_DENIED',
    enforcedBy: 'isVerified() on course create',
  },
  {
    id: 3,
    name: 'Identity Spoofing on Create',
    actor: { uid: 'userA', emailVerified: true },
    operation: 'create',
    path: '/users/userA/courses/course_1',
    payload: { userId: 'userB', code: 'BUS 115', name: 'Business Law', description: '' },
    expected: 'PERMISSION_DENIED',
    enforcedBy: 'isValidCourse() data.userId == request.auth.uid',
  },
  {
    id: 4,
    name: 'Shadow Field Injection (API Key / Ghost Field)',
    actor: { uid: 'userA', emailVerified: true },
    operation: 'create',
    path: '/users/userA/courses/course_1',
    payload: { userId: 'userA', code: 'BUS 115', name: 'Business Law', description: '', geminiApiKey: 'AIzaTest' },
    expected: 'PERMISSION_DENIED',
    enforcedBy: 'isValidCourse() data.keys().hasOnly(...)',
  },
  {
    id: 5,
    name: 'Orphaned Topic Creation',
    actor: { uid: 'userA', emailVerified: true },
    operation: 'create',
    path: '/users/userA/courses/missing_course/topics/topic_1',
    payload: { userId: 'userA', courseId: 'missing_course', name: 'Intro', description: '', order: 0 },
    expected: 'PERMISSION_DENIED',
    enforcedBy: 'courseExists(userId, courseId) Master Gate',
  },
  {
    id: 6,
    name: 'ID Poisoning with Invalid Characters',
    actor: { uid: 'userA', emailVerified: true },
    operation: 'create',
    path: '/users/userA/courses/bad$id!symbols',
    payload: { userId: 'userA', code: 'MGT 101', name: 'Management', description: '' },
    expected: 'PERMISSION_DENIED',
    enforcedBy: 'isValidId(courseId) regex guard',
  },
  {
    id: 7,
    name: 'Client Timestamp Forgery',
    actor: { uid: 'userA', emailVerified: true },
    operation: 'create',
    path: '/users/userA/courses/course_2',
    payload: { userId: 'userA', code: 'ECO 101', name: 'Economics', description: '', createdAt: '2020-01-01T00:00:00Z' },
    expected: 'PERMISSION_DENIED',
    enforcedBy: 'incoming().createdAt == request.time',
  },
  {
    id: 8,
    name: 'Immutable Field Tampering on Update',
    actor: { uid: 'userA', emailVerified: true },
    operation: 'update',
    path: '/users/userA/courses/course_1',
    payload: { userId: 'userB' },
    expected: 'PERMISSION_DENIED',
    enforcedBy: 'incoming().userId == existing().userId && affectedKeys().hasOnly(...)',
  },
  {
    id: 9,
    name: 'Resource Poisoning (Oversized String)',
    actor: { uid: 'userA', emailVerified: true },
    operation: 'create',
    path: '/users/userA/courses/course_3',
    payload: { userId: 'userA', code: 'CS 101', name: 'A'.repeat(10000), description: '' },
    expected: 'PERMISSION_DENIED',
    enforcedBy: 'isNonEmptyString(data.name, 120)',
  },
  {
    id: 10,
    name: 'Terminal State Violation on Completed Study Session',
    actor: { uid: 'userA', emailVerified: true },
    operation: 'update',
    path: '/users/userA/courses/course_1/studySessions/sess_done',
    payload: { status: 'active' },
    expected: 'PERMISSION_DENIED',
    enforcedBy: "existing().status != 'completed'",
  },
  {
    id: 11,
    name: 'Value Poisoning on Whitelisted Update Field',
    actor: { uid: 'userA', emailVerified: true },
    operation: 'update',
    path: '/users/userA/courses/course_1',
    payload: { name: true },
    expected: 'PERMISSION_DENIED',
    enforcedBy: 'isValidCourse(incoming(), userId) in update gate',
  },
  {
    id: 12,
    name: 'Cross-User List Scraping',
    actor: { uid: 'userB', emailVerified: true },
    operation: 'list',
    path: '/users/userA/courses',
    expected: 'PERMISSION_DENIED',
    enforcedBy: 'isOwner(userId) && resource.data.userId == request.auth.uid',
  },
];
