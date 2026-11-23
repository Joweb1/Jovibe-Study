import { Router } from 'express';
import { requireAuth, upsertUserFromAuth } from './auth.ts';
import { createAdminAlert, createId, getDb } from './db.ts';
import { getUserAccessStatus } from './quotaService.ts';

export function createUserSyncRouter(): Router {
  const router = Router();

  // All /api/me/* and /api/groups/* routes require verified Firebase authentication
  router.use(requireAuth);

  /**
   * GET /api/me/access-status
   * Authoritative server-side status for admin visibility, account status,
   * feature flags, 7-day free AI access countdown/expiry, and daily quota progress.
   */
  router.get('/me/access-status', (req, res) => {
    const authUser = req.authUser!;
    const status = getUserAccessStatus(authUser.uid);
    res.json({
      isAdmin: authUser.isAdmin,
      ...status,
    });
  });

  /**
   * POST /api/me/acknowledge-free-access-notice
   * Marks the first-login 7-day free AI access popup as acknowledged.
   */
  router.post('/me/acknowledge-free-access-notice', (req, res) => {
    const authUser = req.authUser!;
    const db = getDb();
    db.prepare(
      'UPDATE users SET first_login_notice_seen = 1, updated_at_ms = ? WHERE uid = ?'
    ).run(Date.now(), authUser.uid);
    res.json({ ok: true });
  });

  /**
   * POST /api/me/sync
   * Mirrors user profile onboarding date, personal-key flag, courses, uploaded materials metadata,
   * and study groups into the server database so Admin Dashboard analytics & Group Study Management
   * reflect real live platform data.
   */
  router.post('/me/sync', (req, res) => {
    const authUser = req.authUser!;
    const body = (req.body ?? {}) as {
      createdAtMs?: number;
      hasPersonalKey?: boolean;
      courses?: Array<{
        id?: string;
        code?: string;
        name?: string;
        description?: string;
        isPublic?: boolean;
        shareToken?: string;
        authorName?: string;
        isOwner?: boolean;
        createdAtMs?: number;
        updatedAtMs?: number;
      }>;
      materials?: Array<{
        courseId?: string;
        sourceId?: string;
        title?: string;
        materialType?: string;
        pageCount?: number;
        originalFileName?: string;
        contentPreview?: string;
        createdAtMs?: number;
        updatedAtMs?: number;
      }>;
      groups?: Array<{
        id?: string;
        courseId?: string;
        courseCode?: string;
        courseName?: string;
        name?: string;
        description?: string;
        shareToken?: string;
        authorUid?: string;
        authorName?: string;
        members?: Array<{
          uid?: string;
          displayName?: string;
          email?: string;
          photoURL?: string;
          joinedAtMs?: number;
        }>;
        createdAtMs?: number;
      }>;
    };

    const db = getDb();
    const now = Date.now();
    upsertUserFromAuth(authUser, body.createdAtMs);

    if (typeof body.hasPersonalKey === 'boolean') {
      db.prepare('UPDATE users SET has_personal_key = ?, updated_at_ms = ? WHERE uid = ?').run(
        body.hasPersonalKey ? 1 : 0,
        now,
        authUser.uid
      );
    }

    if (Array.isArray(body.courses)) {
      const ownedCourses = body.courses.filter((c) => c && typeof c.id === 'string' && c.isOwner !== false);
      const upsertCourse = db.prepare(
        `INSERT INTO user_courses_mirror (
          uid, course_id, code, name, description, is_public, share_token, author_name,
          materials_count, created_at_ms, updated_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
        ON CONFLICT(uid, course_id) DO UPDATE SET
          code = excluded.code,
          name = excluded.name,
          description = excluded.description,
          is_public = excluded.is_public,
          share_token = excluded.share_token,
          author_name = excluded.author_name,
          updated_at_ms = excluded.updated_at_ms`
      );

      for (const c of ownedCourses.slice(0, 200)) {
        upsertCourse.run(
          authUser.uid,
          String(c.id).slice(0, 128),
          String(c.code || '').slice(0, 32),
          String(c.name || '').slice(0, 120),
          String(c.description || '').slice(0, 1000),
          c.isPublic ? 1 : 0,
          String(c.shareToken || '').slice(0, 128),
          String(c.authorName || authUser.displayName).slice(0, 120),
          typeof c.createdAtMs === 'number' && c.createdAtMs > 0 ? Math.floor(c.createdAtMs) : now,
          typeof c.updatedAtMs === 'number' && c.updatedAtMs > 0 ? Math.floor(c.updatedAtMs) : now
        );
      }

      const courseCountRow = db
        .prepare('SELECT COUNT(*) AS cnt FROM user_courses_mirror WHERE uid = ?')
        .get(authUser.uid) as { cnt?: number };
      db.prepare('UPDATE users SET courses_count = ?, updated_at_ms = ? WHERE uid = ?').run(
        Number(courseCountRow?.cnt ?? 0),
        now,
        authUser.uid
      );
    }

    if (Array.isArray(body.materials)) {
      const upsertMat = db.prepare(
        `INSERT INTO user_materials_mirror (
          uid, course_id, source_id, title, material_type, page_count,
          original_file_name, content_preview, created_at_ms, updated_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(uid, course_id, source_id) DO UPDATE SET
          title = excluded.title,
          material_type = excluded.material_type,
          page_count = excluded.page_count,
          original_file_name = excluded.original_file_name,
          content_preview = excluded.content_preview,
          updated_at_ms = excluded.updated_at_ms`
      );

      for (const m of body.materials.slice(0, 500)) {
        if (!m || typeof m.courseId !== 'string' || typeof m.sourceId !== 'string') continue;
        upsertMat.run(
          authUser.uid,
          m.courseId.slice(0, 128),
          m.sourceId.slice(0, 128),
          String(m.title || 'Untitled').slice(0, 200),
          String(m.materialType || 'other').slice(0, 40),
          Math.max(0, Math.floor(Number(m.pageCount) || 0)),
          String(m.originalFileName || '').slice(0, 260),
          String(m.contentPreview || '').slice(0, 600),
          typeof m.createdAtMs === 'number' && m.createdAtMs > 0 ? Math.floor(m.createdAtMs) : now,
          typeof m.updatedAtMs === 'number' && m.updatedAtMs > 0 ? Math.floor(m.updatedAtMs) : now
        );
      }

      const matCountRow = db
        .prepare("SELECT COUNT(*) AS cnt FROM user_materials_mirror WHERE uid = ? AND status != 'deleted'")
        .get(authUser.uid) as { cnt?: number };
      db.prepare('UPDATE users SET materials_count = ?, updated_at_ms = ? WHERE uid = ?').run(
        Number(matCountRow?.cnt ?? 0),
        now,
        authUser.uid
      );
    }

    if (Array.isArray(body.groups)) {
      for (const g of body.groups.slice(0, 100)) {
        if (!g || typeof g.id !== 'string' || typeof g.courseId !== 'string') continue;
        const groupId = g.id.slice(0, 128);
        const existingGroup = db
          .prepare('SELECT id, status, author_uid FROM study_groups WHERE id = ?')
          .get(groupId) as { id?: string; status?: string; author_uid?: string } | undefined;

        const ownerUid = (g.authorUid || authUser.uid).slice(0, 128);
        const ownerName = String(g.authorName || authUser.displayName).slice(0, 120);

        if (!existingGroup) {
          db.prepare(
            `INSERT INTO study_groups (
              id, author_uid, author_email, author_name, course_id, course_code, course_name,
              name, description, status, share_token, member_count, last_activity_at_ms, created_at_ms, updated_at_ms
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, 1, ?, ?, ?)`
          ).run(
            groupId,
            ownerUid,
            ownerUid === authUser.uid ? authUser.email : '',
            ownerName,
            g.courseId.slice(0, 128),
            String(g.courseCode || '').slice(0, 32),
            String(g.courseName || '').slice(0, 120),
            String(g.name || 'Study Group').slice(0, 100),
            String(g.description || '').slice(0, 400),
            String(g.shareToken || '').slice(0, 128),
            now,
            typeof g.createdAtMs === 'number' && g.createdAtMs > 0 ? Math.floor(g.createdAtMs) : now,
            now
          );

          db.prepare(
            `INSERT OR IGNORE INTO group_members (
              group_id, member_uid, display_name, email, photo_url, role, status, joined_at_ms, updated_at_ms
            ) VALUES (?, ?, ?, ?, ?, 'owner', 'active', ?, ?)`
          ).run(
            groupId,
            ownerUid,
            ownerName,
            ownerUid === authUser.uid ? authUser.email : '',
            ownerUid === authUser.uid ? authUser.photoURL : '',
            now,
            now
          );
        } else if (existingGroup.status === 'active') {
          db.prepare(
            `UPDATE study_groups
             SET name = ?, description = ?, course_code = ?, course_name = ?,
                 share_token = CASE WHEN ? != '' THEN ? ELSE share_token END,
                 last_activity_at_ms = ?, updated_at_ms = ?
             WHERE id = ?`
          ).run(
            String(g.name || 'Study Group').slice(0, 100),
            String(g.description || '').slice(0, 400),
            String(g.courseCode || '').slice(0, 32),
            String(g.courseName || '').slice(0, 120),
            String(g.shareToken || '').slice(0, 128),
            String(g.shareToken || '').slice(0, 128),
            now,
            now,
            groupId
          );
        }

        if (Array.isArray(g.members)) {
          for (const mem of g.members.slice(0, 300)) {
            if (!mem || typeof mem.uid !== 'string' || !mem.uid.trim()) continue;
            const mUid = mem.uid.slice(0, 128);
            const existingMem = db
              .prepare('SELECT status, role FROM group_members WHERE group_id = ? AND member_uid = ?')
              .get(groupId, mUid) as { status?: string; role?: string } | undefined;
            if (existingMem?.status === 'removed') continue; // Respect admin member removal
            if (!existingMem) {
              db.prepare(
                `INSERT INTO group_members (
                  group_id, member_uid, display_name, email, photo_url, role, status, joined_at_ms, updated_at_ms
                ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`
              ).run(
                groupId,
                mUid,
                String(mem.displayName || 'Student').slice(0, 120),
                String(mem.email || '').slice(0, 254),
                String(mem.photoURL || '').slice(0, 500),
                mUid === ownerUid ? 'owner' : 'member',
                typeof mem.joinedAtMs === 'number' ? Math.floor(mem.joinedAtMs) : now,
                now
              );
            }
          }
          const cntRow = db
            .prepare("SELECT COUNT(*) AS cnt FROM group_members WHERE group_id = ? AND status = 'active'")
            .get(groupId) as { cnt?: number };
          db.prepare('UPDATE study_groups SET member_count = ?, updated_at_ms = ? WHERE id = ?').run(
            Math.max(1, Number(cntRow?.cnt ?? 1)),
            now,
            groupId
          );
        }
      }
    }

    res.json({ ok: true });
  });

  /**
   * POST /api/me/activity
   * Records feature / material upload / study activity events for analytics & user profiles.
   */
  router.post('/me/activity', (req, res) => {
    const authUser = req.authUser!;
    const { eventType, feature, courseId, title, metadata } = (req.body ?? {}) as {
      eventType?: string;
      feature?: string;
      courseId?: string;
      title?: string;
      metadata?: Record<string, unknown>;
    };

    if (typeof eventType !== 'string' || !eventType.trim()) {
      res.status(400).json({ error: 'eventType is required.' });
      return;
    }

    const db = getDb();
    db.prepare(
      `INSERT INTO user_activity_events (id, uid, event_type, feature, course_id, title, metadata_json, created_at_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      createId('uact'),
      authUser.uid,
      eventType.trim().slice(0, 60),
      typeof feature === 'string' ? feature.trim().slice(0, 60) : '',
      typeof courseId === 'string' ? courseId.trim().slice(0, 128) : '',
      typeof title === 'string' ? title.trim().slice(0, 200) : '',
      JSON.stringify(metadata && typeof metadata === 'object' ? metadata : {}),
      Date.now()
    );

    res.json({ ok: true });
  });

  /**
   * GET /api/groups/:groupId/status
   * Returns moderation status and active shared notes for a study group.
   */
  router.get('/groups/:groupId/status', (req, res) => {
    const authUser = req.authUser!;
    const groupId = String(req.params.groupId || '').slice(0, 128);
    const db = getDb();

    const group = db
      .prepare('SELECT * FROM study_groups WHERE id = ?')
      .get(groupId) as Record<string, unknown> | undefined;
    if (!group) {
      res.status(404).json({ error: 'Study group not found.' });
      return;
    }

    const membership = db
      .prepare('SELECT status, role FROM group_members WHERE group_id = ? AND member_uid = ?')
      .get(groupId, authUser.uid) as { status?: string; role?: string } | undefined;

    if (!authUser.isAdmin && membership?.status === 'removed') {
      res.status(403).json({ error: 'You have been removed from this study group.', code: 'MEMBER_REMOVED' });
      return;
    }

    const notes = db
      .prepare(
        `SELECT id, group_id, author_uid, author_name, title, content, status, created_at_ms, updated_at_ms
         FROM group_shared_notes
         WHERE group_id = ? AND status = 'active'
         ORDER BY created_at_ms DESC LIMIT 100`
      )
      .all(groupId);

    res.json({
      group: {
        id: group.id,
        name: group.name,
        description: group.description,
        status: group.status,
        authorUid: group.author_uid,
        authorName: group.author_name,
        memberCount: group.member_count,
      },
      notes,
    });
  });

  /**
   * POST /api/groups/:groupId/notes
   * Adds a shared study note to an active study group.
   */
  router.post('/groups/:groupId/notes', (req, res) => {
    const authUser = req.authUser!;
    const groupId = String(req.params.groupId || '').slice(0, 128);
    const { title, content } = (req.body ?? {}) as { title?: string; content?: string };

    if (typeof title !== 'string' || !title.trim() || typeof content !== 'string' || !content.trim()) {
      res.status(400).json({ error: 'Both title and content are required.' });
      return;
    }

    const db = getDb();
    const group = db
      .prepare('SELECT id, course_id, status FROM study_groups WHERE id = ?')
      .get(groupId) as { id?: string; course_id?: string; status?: string } | undefined;

    if (!group) {
      res.status(404).json({ error: 'Study group not found.' });
      return;
    }
    if (group.status !== 'active') {
      res.status(403).json({ error: `Cannot post to a ${group.status} study group.` });
      return;
    }

    const now = Date.now();
    const noteId = createId('gnote');
    db.prepare(
      `INSERT INTO group_shared_notes (
        id, group_id, course_id, author_uid, author_name, title, content, status, moderation_reason, created_at_ms, updated_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', '', ?, ?)`
    ).run(
      noteId,
      groupId,
      group.course_id || '',
      authUser.uid,
      authUser.displayName,
      title.trim().slice(0, 160),
      content.trim().slice(0, 10000),
      now,
      now
    );

    db.prepare('UPDATE study_groups SET last_activity_at_ms = ?, updated_at_ms = ? WHERE id = ?').run(
      now,
      now,
      groupId
    );
    db.prepare(
      `INSERT INTO group_activity_logs (id, group_id, actor_uid, actor_name, action, details, created_at_ms)
       VALUES (?, ?, ?, ?, 'note_shared', ?, ?)`
    ).run(createId('gact'), groupId, authUser.uid, authUser.displayName, `Shared note "${title.trim().slice(0, 80)}"`, now);

    res.status(201).json({ id: noteId, ok: true });
  });

  /**
   * POST /api/groups/:groupId/report
   * Lets authenticated students report a group, shared note, material, or abusive member.
   */
  router.post('/groups/:groupId/report', (req, res) => {
    const authUser = req.authUser!;
    const groupId = String(req.params.groupId || '').slice(0, 128);
    const { targetType, targetId, targetLabel, reportedUserUid, reportedUserEmail, reason, details } =
      (req.body ?? {}) as {
        targetType?: string;
        targetId?: string;
        targetLabel?: string;
        reportedUserUid?: string;
        reportedUserEmail?: string;
        reason?: string;
        details?: string;
      };

    const allowedTargets = new Set(['group', 'note', 'material', 'member']);
    const cleanTarget = targetType && allowedTargets.has(targetType) ? targetType : 'group';
    if (typeof reason !== 'string' || !reason.trim()) {
      res.status(400).json({ error: 'A report reason is required.' });
      return;
    }

    const db = getDb();
    const group = db
      .prepare('SELECT id, name FROM study_groups WHERE id = ?')
      .get(groupId) as { id?: string; name?: string } | undefined;
    if (!group) {
      res.status(404).json({ error: 'Study group not found.' });
      return;
    }

    const now = Date.now();
    const reportId = createId('rep');
    db.prepare(
      `INSERT INTO group_reports (
        id, group_id, target_type, target_id, target_label, reported_user_uid, reported_user_email,
        reporter_uid, reporter_email, reason, details, status, resolution_note, resolved_by, created_at_ms, updated_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', '', '', ?, ?)`
    ).run(
      reportId,
      groupId,
      cleanTarget,
      String(targetId || groupId).slice(0, 128),
      String(targetLabel || group.name || '').slice(0, 160),
      String(reportedUserUid || '').slice(0, 128),
      String(reportedUserEmail || '').slice(0, 254),
      authUser.uid,
      authUser.email,
      reason.trim().slice(0, 160),
      String(details || '').trim().slice(0, 1500),
      now,
      now
    );

    createAdminAlert({
      severity: 'warning',
      category: 'group_report',
      title: `New ${cleanTarget} report in "${group.name || groupId}"`,
      message: `${authUser.email || authUser.uid} reported ${cleanTarget}: ${reason.trim().slice(0, 120)}`,
      metadata: { reportId, groupId, targetType: cleanTarget },
      dedupeWindowMs: 0,
    });

    res.status(201).json({ id: reportId, ok: true });
  });

  return router;
}
