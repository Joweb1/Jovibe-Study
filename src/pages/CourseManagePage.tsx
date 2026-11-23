import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  BookOpen,
  Check,
  Copy,
  CopyPlus,
  FolderPlus,
  Globe,
  Lock,
  Mail,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
  UserMinus,
  Users,
  X,
} from 'lucide-react';
import type { Course, CourseGroup, CourseMember } from '../types/models';
import { useAuth } from '../context/AuthContext';
import { useCourses } from '../context/CourseContext';
import { usePlatformAccess } from '../context/PlatformAccessContext';
import { useRouter } from '../router/RouterContext';
import {
  adminDeleteApplicationCourse,
  adminRegenerateApplicationCourseShareToken,
  adminSetApplicationCourseVisibility,
  adminUpdateApplicationCourse,
  fetchApplicationCourseById,
  remixCourseToOwnAccount,
} from '../services/firebase/adminCourseService';
import { formatReadableError } from '../services/firebase/errors';
import {
  assignMemberToGroup,
  buildCourseInviteUrl,
  createCourseGroup,
  deleteCourseGroup,
  removeCourseMember,
  subscribeCourseGroups,
  subscribeCourseMembers,
  updateCourseGroup,
} from '../services/firebase/sharedCourseService';
import { formatShortDate, SCHEMA_LIMITS } from '../utils/validation';
import { CourseModal } from '../components/courses/CourseModal';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { EmptyState, ErrorBanner, LoadingSkeleton } from '../components/ui/StateViews';

export const CourseManagePage: React.FC = () => {
  const { user, profile } = useAuth();
  const {
    ownedCourses,
    activeCourse,
    externalActiveCourse,
    coursesLoading,
    selectCourse,
    selectExternalCourse,
    updateExternalCourseState,
    clearExternalCourse,
    updateCourse,
    deleteCourse,
    setCourseVisibility,
    rotateCourseShareLink,
  } = useCourses();
  const { routeParams, navigate } = useRouter();
  const { isAdmin, syncGroupsMetadata } = usePlatformAccess();

  const ownedTargetCourse = useMemo(() => {
    if (routeParams.courseId) {
      return ownedCourses.find((c) => c.id === routeParams.courseId) ?? null;
    }
    if (activeCourse?.isOwner) {
      return ownedCourses.find((c) => c.id === activeCourse.id) ?? ownedCourses[0] ?? null;
    }
    return ownedCourses[0] ?? null;
  }, [routeParams.courseId, ownedCourses, activeCourse]);

  const [adminTargetCourse, setAdminTargetCourse] = useState<Course | null>(null);
  const [adminCourseLoading, setAdminCourseLoading] = useState(false);

  // If admin navigated to /manage-course/:courseId for another user's course, load it
  useEffect(() => {
    if (!user || !isAdmin || ownedTargetCourse) {
      setAdminTargetCourse(null);
      setAdminCourseLoading(false);
      return;
    }

    const requestedId = routeParams.courseId || (externalActiveCourse?.id ?? '');
    if (!requestedId) {
      setAdminTargetCourse(null);
      setAdminCourseLoading(false);
      return;
    }

    let cancelled = false;
    if (externalActiveCourse && externalActiveCourse.id === requestedId) {
      setAdminTargetCourse(externalActiveCourse);
    }
    setAdminCourseLoading(true);

    const ownerHint =
      externalActiveCourse?.id === requestedId
        ? externalActiveCourse.authorId || externalActiveCourse.userId
        : undefined;

    void fetchApplicationCourseById(requestedId, user.uid, ownerHint)
      .then((found) => {
        if (cancelled) return;
        setAdminTargetCourse(found);
        setAdminCourseLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(formatReadableError(err));
        setAdminCourseLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [user, isAdmin, ownedTargetCourse, routeParams.courseId, externalActiveCourse]);

  const targetCourse = ownedTargetCourse ?? (isAdmin ? adminTargetCourse : null);
  const targetOwnerUid = targetCourse ? targetCourse.authorId || targetCourse.userId : user?.uid ?? '';
  const isManagingOtherUserCourse = Boolean(targetCourse && user && targetOwnerUid !== user.uid);

  const [members, setMembers] = useState<CourseMember[]>([]);
  const [groups, setGroups] = useState<CourseGroup[]>([]);
  const [membersLoading, setMembersLoading] = useState(true);
  const [groupsLoading, setGroupsLoading] = useState(true);

  const [togglingPublic, setTogglingPublic] = useState(false);
  const [rotatingLink, setRotatingLink] = useState(false);
  const [rotateConfirmOpen, setRotateConfirmOpen] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  const [editModalOpen, setEditModalOpen] = useState(false);
  const [deleteCourseModalOpen, setDeleteCourseModalOpen] = useState(false);
  const [deletingCourse, setDeletingCourse] = useState(false);
  const [remixingCourse, setRemixingCourse] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGroupFilter, setSelectedGroupFilter] = useState<string>('all');

  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<CourseGroup | null>(null);
  const [groupName, setGroupName] = useState('');
  const [groupDescription, setGroupDescription] = useState('');
  const [savingGroup, setSavingGroup] = useState(false);

  const [groupToDelete, setGroupToDelete] = useState<CourseGroup | null>(null);
  const [deletingGroup, setDeletingGroup] = useState(false);

  const [memberToRemove, setMemberToRemove] = useState<CourseMember | null>(null);
  const [removingMember, setRemovingMember] = useState(false);
  const [updatingMemberUid, setUpdatingMemberUid] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user || !targetCourse || !targetOwnerUid) {
      setMembers([]);
      setGroups([]);
      setMembersLoading(false);
      setGroupsLoading(false);
      return;
    }

    let cancelled = false;
    setMembersLoading(true);
    setGroupsLoading(true);

    const unsubMembers = subscribeCourseMembers(
      targetOwnerUid,
      targetCourse.id,
      (liveMembers) => {
        if (cancelled) return;
        setMembers(liveMembers);
        setMembersLoading(false);
      },
      (err) => {
        if (cancelled) return;
        setError(formatReadableError(err));
        setMembersLoading(false);
      }
    );

    const unsubGroups = subscribeCourseGroups(
      targetOwnerUid,
      targetCourse.id,
      (liveGroups) => {
        if (cancelled) return;
        setGroups(liveGroups);
        setGroupsLoading(false);
      },
      (err) => {
        if (cancelled) return;
        setError(formatReadableError(err));
        setGroupsLoading(false);
      }
    );

    return () => {
      cancelled = true;
      unsubMembers();
      unsubGroups();
    };
  }, [user, targetCourse?.id, targetOwnerUid]);

  // Mirror course study groups & members to server DB for Admin Group Study Management
  useEffect(() => {
    if (!user || !targetCourse || !targetOwnerUid || groupsLoading || membersLoading) return;
    if (groups.length === 0) return;
    void syncGroupsMetadata(
      groups.map((g) => ({
        id: g.id,
        courseId: targetCourse.id,
        courseCode: targetCourse.code,
        courseName: targetCourse.name,
        name: g.name,
        description: g.description,
        shareToken: targetCourse.shareToken || '',
        authorUid: targetOwnerUid,
        authorName: targetCourse.authorName || user.displayName || 'Course Author',
        members: members
          .filter((m) => !m.groupId || m.groupId === g.id)
          .map((m) => ({
            uid: m.memberUid,
            displayName: m.displayName,
            photoURL: m.photoURL,
          })),
      }))
    );
  }, [user, targetCourse, targetOwnerUid, groups, members, groupsLoading, membersLoading, syncGroupsMetadata]);

  const groupMemberCounts = useMemo(() => {
    const counts = new Map<string, number>();
    let unassigned = 0;
    for (const member of members) {
      if (member.groupId) {
        counts.set(member.groupId, (counts.get(member.groupId) || 0) + 1);
      } else {
        unassigned += 1;
      }
    }
    return { counts, unassigned };
  }, [members]);

  const filteredMembers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return members.filter((m) => {
      if (selectedGroupFilter === 'unassigned' && m.groupId !== '') return false;
      if (
        selectedGroupFilter !== 'all' &&
        selectedGroupFilter !== 'unassigned' &&
        m.groupId !== selectedGroupFilter
      ) {
        return false;
      }
      if (q && !m.displayName.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [members, selectedGroupFilter, searchQuery]);

  const inviteUrl = targetCourse?.shareToken ? buildCourseInviteUrl(targetCourse.shareToken) : '';

  const handleToggleVisibility = async () => {
    if (!targetCourse) return;
    setTogglingPublic(true);
    setError(null);
    try {
      if (isManagingOtherUserCourse) {
        const result = await adminSetApplicationCourseVisibility(targetCourse, !targetCourse.isPublic);
        setAdminTargetCourse((prev) =>
          prev ? { ...prev, isPublic: result.isPublic, shareToken: result.shareToken } : prev
        );
        updateExternalCourseState((prev) =>
          prev && prev.id === targetCourse.id
            ? { ...prev, isPublic: result.isPublic, shareToken: result.shareToken }
            : prev
        );
      } else {
        await setCourseVisibility(targetCourse.id, !targetCourse.isPublic);
      }
    } catch (err) {
      setError(formatReadableError(err));
    } finally {
      setTogglingPublic(false);
    }
  };

  const handleCopyLink = async () => {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2200);
    } catch {
      setError('Unable to copy automatically. Select and copy the link manually.');
    }
  };

  const handleConfirmRotateLink = async () => {
    if (!targetCourse) return;
    setRotatingLink(true);
    setError(null);
    try {
      if (isManagingOtherUserCourse) {
        const nextToken = await adminRegenerateApplicationCourseShareToken(targetCourse);
        setAdminTargetCourse((prev) =>
          prev ? { ...prev, isPublic: true, shareToken: nextToken } : prev
        );
        updateExternalCourseState((prev) =>
          prev && prev.id === targetCourse.id
            ? { ...prev, isPublic: true, shareToken: nextToken }
            : prev
        );
      } else {
        await rotateCourseShareLink(targetCourse.id);
      }
      setRotateConfirmOpen(false);
    } catch (err) {
      setError(formatReadableError(err));
    } finally {
      setRotatingLink(false);
    }
  };

  const handleEditCourseDetails = async (input: { code: string; name: string; description: string }) => {
    if (!targetCourse) return;
    if (isManagingOtherUserCourse) {
      await adminUpdateApplicationCourse(targetCourse, input);
      setAdminTargetCourse((prev) => (prev ? { ...prev, ...input } : prev));
      updateExternalCourseState((prev) =>
        prev && prev.id === targetCourse.id ? { ...prev, ...input } : prev
      );
    } else {
      await updateCourse(targetCourse.id, input);
    }
    setNotice('Course details updated.');
  };

  const handleRemixCourse = async () => {
    if (!user || !targetCourse) return;
    setRemixingCourse(true);
    setError(null);
    setNotice(null);
    try {
      const result = await remixCourseToOwnAccount({
        adminUid: user.uid,
        adminDisplayName: profile?.displayName || user.displayName || 'Admin',
        sourceCourse: targetCourse,
      });
      await selectCourse(result.course.id);
      setNotice(
        `Remixed "${result.course.code}" into your account (${result.topicsCopied} ${
          result.topicsCopied === 1 ? 'topic' : 'topics'
        }, ${result.sourcesCopied} ${result.sourcesCopied === 1 ? 'material' : 'materials'} copied).`
      );
    } catch (err) {
      setError(formatReadableError(err));
    } finally {
      setRemixingCourse(false);
    }
  };

  const handleConfirmDeleteCourse = async () => {
    if (!targetCourse) return;
    setDeletingCourse(true);
    setError(null);
    try {
      if (isManagingOtherUserCourse) {
        await adminDeleteApplicationCourse(targetCourse);
        if (externalActiveCourse?.id === targetCourse.id) {
          clearExternalCourse();
        }
      } else {
        await deleteCourse(targetCourse.id);
      }
      setDeleteCourseModalOpen(false);
      navigate('/courses');
    } catch (err) {
      setError(formatReadableError(err));
    } finally {
      setDeletingCourse(false);
    }
  };

  const openCreateGroupModal = () => {
    setEditingGroup(null);
    setGroupName('');
    setGroupDescription('');
    setGroupModalOpen(true);
  };

  const openEditGroupModal = (group: CourseGroup) => {
    setEditingGroup(group);
    setGroupName(group.name);
    setGroupDescription(group.description);
    setGroupModalOpen(true);
  };

  const handleSaveGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !targetCourse || !targetOwnerUid) return;
    if (!groupName.trim()) {
      setError('Group name is required.');
      return;
    }

    setSavingGroup(true);
    setError(null);
    try {
      if (editingGroup) {
        await updateCourseGroup({
          authorId: targetOwnerUid,
          courseId: targetCourse.id,
          groupId: editingGroup.id,
          name: groupName,
          description: groupDescription,
        });
      } else {
        await createCourseGroup({
          authorId: targetOwnerUid,
          courseId: targetCourse.id,
          name: groupName,
          description: groupDescription,
        });
      }
      setGroupModalOpen(false);
      setEditingGroup(null);
    } catch (err) {
      setError(formatReadableError(err));
    } finally {
      setSavingGroup(false);
    }
  };

  const handleConfirmDeleteGroup = async () => {
    if (!user || !targetCourse || !targetOwnerUid || !groupToDelete) return;
    setDeletingGroup(true);
    setError(null);
    try {
      await deleteCourseGroup({
        authorId: targetOwnerUid,
        courseId: targetCourse.id,
        groupId: groupToDelete.id,
      });
      if (selectedGroupFilter === groupToDelete.id) {
        setSelectedGroupFilter('all');
      }
      setGroupToDelete(null);
    } catch (err) {
      setError(formatReadableError(err));
    } finally {
      setDeletingGroup(false);
    }
  };

  const handleAssignGroup = async (memberUid: string, nextGroupId: string) => {
    if (!user || !targetCourse || !targetOwnerUid) return;
    setUpdatingMemberUid(memberUid);
    setError(null);
    try {
      await assignMemberToGroup({
        authorId: targetOwnerUid,
        courseId: targetCourse.id,
        memberUid,
        groupId: nextGroupId,
      });
    } catch (err) {
      setError(formatReadableError(err));
    } finally {
      setUpdatingMemberUid(null);
    }
  };

  const handleConfirmRemoveMember = async () => {
    if (!user || !targetCourse || !targetOwnerUid || !memberToRemove) return;
    setRemovingMember(true);
    setError(null);
    try {
      await removeCourseMember(targetOwnerUid, targetCourse.id, memberToRemove.memberUid);
      setMemberToRemove(null);
    } catch (err) {
      setError(formatReadableError(err));
    } finally {
      setRemovingMember(false);
    }
  };

  if (coursesLoading || adminCourseLoading) {
    return <LoadingSkeleton lines={5} />;
  }

  if (!targetCourse) {
    return (
      <div className="space-y-6">
        <button
          type="button"
          onClick={() => navigate('/courses')}
          className="inline-flex items-center gap-1.5 text-sm text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-200 cursor-pointer"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Courses
        </button>
        <EmptyState
          title="No manageable course found"
          description="Only the course author or an administrator can manage sharing settings, members, and study groups."
          actionLabel="Go to Courses"
          onAction={() => navigate('/courses')}
        />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Top Bar */}
      <div className="space-y-4 border-b border-zinc-200 dark:border-zinc-800 pb-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => navigate('/courses')}
            className="inline-flex items-center gap-1.5 text-sm text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-200 cursor-pointer transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Courses
          </button>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setEditModalOpen(true)}
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit details
            </Button>
            {isAdmin && (
              <Button
                variant="secondary"
                size="sm"
                loading={remixingCourse}
                onClick={() => void handleRemixCourse()}
              >
                <CopyPlus className="h-3.5 w-3.5" />
                Remix to my courses
              </Button>
            )}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                if (isManagingOtherUserCourse) {
                  void selectExternalCourse(targetCourse);
                } else {
                  void selectCourse(targetCourse.id);
                }
                navigate('/library');
              }}
            >
              <BookOpen className="h-3.5 w-3.5" />
              Open Library
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDeleteCourseModalOpen(true)}
              className="text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 hover:text-red-700 dark:hover:text-red-300"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </Button>
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">
            <span className="font-mono font-medium text-zinc-900 dark:text-zinc-200">
              {targetCourse.code}
            </span>
            <span aria-hidden="true">·</span>
            <span className={targetCourse.isPublic ? 'font-medium text-emerald-700 dark:text-emerald-400' : ''}>
              {targetCourse.isPublic ? 'Public shared course' : 'Private course'}
            </span>
            <span aria-hidden="true">·</span>
            <span>
              {members.length} {members.length === 1 ? 'member' : 'members'}
            </span>
            <span aria-hidden="true">·</span>
            <span>
              {groups.length} {groups.length === 1 ? 'group' : 'groups'}
            </span>
          </div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-200">
            {targetCourse.name}
          </h1>
          {isManagingOtherUserCourse && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400 pt-0.5">
              <Mail className="h-3.5 w-3.5 shrink-0" />
              <span>Owner:</span>
              <span className="font-medium text-zinc-800 dark:text-zinc-200">
                {targetCourse.ownerEmail || targetCourse.authorName || targetOwnerUid}
              </span>
            </div>
          )}
        </div>
      </div>

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
      {notice && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 px-4 py-2.5 text-xs text-zinc-800 dark:text-zinc-200">
          <span>{notice}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="text-zinc-500 hover:text-zinc-950 dark:hover:text-zinc-100 cursor-pointer"
            aria-label="Dismiss notice"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Section 1: Visibility & Invite Link Controls */}
      <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 sm:p-6 space-y-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300">
              {targetCourse.isPublic ? (
                <Globe className="h-4 w-4" />
              ) : (
                <Lock className="h-4 w-4" />
              )}
            </div>
            <div className="space-y-1">
              <h2 className="text-sm font-semibold text-zinc-950 dark:text-zinc-200">
                Public course sharing
              </h2>
              <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400 max-w-xl">
                {targetCourse.isPublic
                  ? 'Anyone with the invite link can join immediately and learn from your materials and topics. Only you can upload, edit, or delete course materials.'
                  : 'Private to your account. Switch to public to generate an invite link so others can join and study from this library.'}
              </p>
            </div>
          </div>

          <Button
            variant={targetCourse.isPublic ? 'secondary' : 'primary'}
            size="sm"
            loading={togglingPublic}
            onClick={() => void handleToggleVisibility()}
            className="shrink-0"
          >
            {targetCourse.isPublic ? 'Switch to private' : 'Make course public'}
          </Button>
        </div>

        {targetCourse.isPublic && inviteUrl && (
          <div className="border-t border-zinc-200 dark:border-zinc-800 pt-4 space-y-2.5">
            <label
              htmlFor="course-invite-link"
              className="block text-xs font-medium text-zinc-700 dark:text-zinc-300"
            >
              Shareable invite link
            </label>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <input
                id="course-invite-link"
                type="text"
                readOnly
                value={inviteUrl}
                onFocus={(e) => e.currentTarget.select()}
                className="min-w-0 flex-1 rounded-md border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-900 dark:text-zinc-200 focus:border-zinc-950 dark:focus:border-zinc-400 focus:outline-none"
              />
              <div className="flex items-center gap-2 shrink-0">
                <Button size="sm" onClick={() => void handleCopyLink()}>
                  {copiedLink ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copiedLink ? 'Copied' : 'Copy link'}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setRotateConfirmOpen(true)}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Regenerate
                </Button>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Section 2: Named Study Groups */}
      <section className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <h2 className="text-sm font-semibold text-zinc-950 dark:text-zinc-200">
              Study groups
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Organize joined learners into named cohorts or sections.
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={openCreateGroupModal}>
            <FolderPlus className="h-3.5 w-3.5" />
            New group
          </Button>
        </div>

        {groupsLoading ? (
          <LoadingSkeleton lines={2} />
        ) : groups.length === 0 ? (
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-5 py-6 text-center">
            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-200">
              No study groups yet
            </p>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Create groups like &ldquo;Section A&rdquo; or &ldquo;Exam Revision Group&rdquo; to organize joined members.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {groups.map((group) => {
              const count = groupMemberCounts.counts.get(group.id) || 0;
              const isFiltering = selectedGroupFilter === group.id;
              return (
                <div
                  key={group.id}
                  className={`rounded-xl border p-4 transition-colors ${
                    isFiltering
                      ? 'border-zinc-950 dark:border-zinc-300 bg-zinc-50 dark:bg-zinc-800/70'
                      : 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedGroupFilter((prev) => (prev === group.id ? 'all' : group.id))
                      }
                      className="min-w-0 flex-1 text-left cursor-pointer"
                    >
                      <div className="truncate text-sm font-semibold text-zinc-950 dark:text-zinc-200">
                        {group.name}
                      </div>
                      <div className="mt-0.5 font-mono text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">
                        {count} {count === 1 ? 'member' : 'members'}
                      </div>
                    </button>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => openEditGroupModal(group)}
                        aria-label={`Edit ${group.name}`}
                        title="Edit group"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200 cursor-pointer"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setGroupToDelete(group)}
                        aria-label={`Delete ${group.name}`}
                        title="Delete group"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 hover:bg-red-50 hover:text-red-700 dark:text-zinc-400 dark:hover:bg-red-950/40 dark:hover:text-red-400 cursor-pointer"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  {group.description && (
                    <p className="mt-2 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400 line-clamp-2">
                      {group.description}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Section 3: Members Directory */}
      <section className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-baseline gap-2.5">
            <h2 className="text-sm font-semibold text-zinc-950 dark:text-zinc-200">
              Joined members
            </h2>
            <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">
              {filteredMembers.length} of {members.length}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[180px] flex-1 sm:flex-none">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400 dark:text-zinc-500" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter members..."
                aria-label="Filter joined members"
                className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 py-1.5 pl-8 pr-7 text-xs text-zinc-950 dark:text-zinc-200 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:border-zinc-950 dark:focus:border-zinc-400 focus:outline-none"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  aria-label="Clear member search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 cursor-pointer"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <select
              value={selectedGroupFilter}
              onChange={(e) => setSelectedGroupFilter(e.target.value)}
              aria-label="Filter by group"
              className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-900 dark:text-zinc-200 focus:border-zinc-950 dark:focus:border-zinc-400 focus:outline-none"
            >
              <option value="all">All groups ({members.length})</option>
              <option value="unassigned">Unassigned ({groupMemberCounts.unassigned})</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name} ({groupMemberCounts.counts.get(g.id) || 0})
                </option>
              ))}
            </select>
          </div>
        </div>

        {membersLoading ? (
          <LoadingSkeleton lines={3} />
        ) : members.length === 0 ? (
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-5 py-10 text-center space-y-2">
            <Users className="mx-auto h-6 w-6 text-zinc-400 dark:text-zinc-500" />
            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-200">
              No learners have joined yet
            </p>
            <p className="mx-auto max-w-sm text-xs text-zinc-500 dark:text-zinc-400">
              {targetCourse.isPublic
                ? 'Share the invite link above with your classmates or study group. Members will appear here as soon as they join.'
                : 'Enable public sharing above to generate an invite link for learners to join.'}
            </p>
          </div>
        ) : filteredMembers.length === 0 ? (
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-5 py-8 text-center text-xs text-zinc-500 dark:text-zinc-400">
            No members match your current search or group filter.
          </div>
        ) : (
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 divide-y divide-zinc-200 dark:divide-zinc-800 overflow-hidden">
            {filteredMembers.map((member) => {
              const initial = (member.displayName || 'S').slice(0, 1).toUpperCase();
              const isUpdating = updatingMemberUid === member.memberUid;

              return (
                <div
                  key={member.memberUid}
                  className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between hover:bg-zinc-50/70 dark:hover:bg-zinc-800/40 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {member.photoURL ? (
                      <img
                        src={member.photoURL}
                        alt={member.displayName}
                        referrerPolicy="no-referrer"
                        className="h-8 w-8 shrink-0 rounded-full border border-zinc-200 dark:border-zinc-700 object-cover"
                      />
                    ) : (
                      <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-zinc-200 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 text-xs font-medium text-zinc-700 dark:text-zinc-300">
                        {initial}
                      </span>
                    )}
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-zinc-950 dark:text-zinc-200">
                        {member.displayName}
                      </div>
                      <div className="font-mono text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">
                        Joined {formatShortDate(member.joinedAt)}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <select
                      aria-label={`Group for ${member.displayName}`}
                      value={member.groupId}
                      disabled={isUpdating}
                      onChange={(e) => void handleAssignGroup(member.memberUid, e.target.value)}
                      className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-800 dark:text-zinc-200 focus:border-zinc-950 dark:focus:border-zinc-400 focus:outline-none disabled:opacity-50"
                    >
                      <option value="">Unassigned</option>
                      {groups.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.name}
                        </option>
                      ))}
                    </select>

                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setMemberToRemove(member)}
                      aria-label={`Remove ${member.displayName}`}
                      className="text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 hover:text-red-700 dark:hover:text-red-300"
                    >
                      <UserMinus className="h-3.5 w-3.5" />
                      Remove
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Regenerate Link Confirmation Modal */}
      <Modal
        open={rotateConfirmOpen}
        title="Regenerate invite link?"
        description="The previous invite link will immediately stop working for new learners. Existing members will remain enrolled in the course."
        onClose={() => {
          if (!rotatingLink) setRotateConfirmOpen(false);
        }}
      >
        <div className="flex items-center justify-end gap-2.5 pt-2">
          <Button
            variant="secondary"
            onClick={() => setRotateConfirmOpen(false)}
            disabled={rotatingLink}
          >
            Cancel
          </Button>
          <Button onClick={() => void handleConfirmRotateLink()} loading={rotatingLink}>
            Regenerate link
          </Button>
        </div>
      </Modal>

      {/* Create / Edit Group Modal */}
      <Modal
        open={groupModalOpen}
        title={editingGroup ? 'Edit study group' : 'New study group'}
        description={`Organize learners in ${targetCourse.code} into named groups.`}
        onClose={() => {
          if (!savingGroup) setGroupModalOpen(false);
        }}
      >
        <form onSubmit={(e) => void handleSaveGroup(e)} className="space-y-4">
          <div>
            <label
              htmlFor="group-name-input"
              className="block text-sm font-medium text-zinc-900 dark:text-zinc-200"
            >
              Group name
            </label>
            <input
              id="group-name-input"
              type="text"
              required
              maxLength={SCHEMA_LIMITS.GROUP_NAME_MAX}
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="e.g., Section A, Evening Study Cohort"
              className="mt-1.5 w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm text-zinc-950 dark:text-zinc-200 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:border-zinc-950 dark:focus:border-zinc-400 focus:outline-none"
            />
          </div>

          <div>
            <label
              htmlFor="group-desc-input"
              className="block text-sm font-medium text-zinc-900 dark:text-zinc-200"
            >
              Description <span className="font-normal text-zinc-400">(optional)</span>
            </label>
            <textarea
              id="group-desc-input"
              rows={3}
              maxLength={SCHEMA_LIMITS.GROUP_DESC_MAX}
              value={groupDescription}
              onChange={(e) => setGroupDescription(e.target.value)}
              placeholder="Short note about this cohort..."
              className="mt-1.5 w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm text-zinc-950 dark:text-zinc-200 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:border-zinc-950 dark:focus:border-zinc-400 focus:outline-none"
            />
          </div>

          <div className="flex items-center justify-end gap-2.5 border-t border-zinc-100 dark:border-zinc-800 pt-4">
            <Button
              variant="secondary"
              onClick={() => setGroupModalOpen(false)}
              disabled={savingGroup}
            >
              Cancel
            </Button>
            <Button type="submit" loading={savingGroup}>
              {editingGroup ? 'Save group' : 'Create group'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete Group Confirmation Modal */}
      <Modal
        open={Boolean(groupToDelete)}
        title="Delete study group?"
        description={
          groupToDelete
            ? `Delete "${groupToDelete.name}"? Members in this group will become unassigned, and will keep their access to the course.`
            : undefined
        }
        onClose={() => {
          if (!deletingGroup) setGroupToDelete(null);
        }}
      >
        <div className="flex items-center justify-end gap-2.5 pt-2">
          <Button
            variant="secondary"
            onClick={() => setGroupToDelete(null)}
            disabled={deletingGroup}
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => void handleConfirmDeleteGroup()}
            loading={deletingGroup}
          >
            Delete group
          </Button>
        </div>
      </Modal>

      {/* Remove Member Confirmation Modal */}
      <Modal
        open={Boolean(memberToRemove)}
        title="Remove member?"
        description={
          memberToRemove
            ? `Remove ${memberToRemove.displayName} from "${targetCourse.code} — ${targetCourse.name}"? Their read access to course materials will be revoked immediately.`
            : undefined
        }
        onClose={() => {
          if (!removingMember) setMemberToRemove(null);
        }}
      >
        <div className="flex items-center justify-end gap-2.5 pt-2">
          <Button
            variant="secondary"
            onClick={() => setMemberToRemove(null)}
            disabled={removingMember}
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => void handleConfirmRemoveMember()}
            loading={removingMember}
          >
            Remove member
          </Button>
        </div>
      </Modal>

      {/* Edit Course Details Modal */}
      <CourseModal
        open={editModalOpen}
        initialCourse={targetCourse}
        onClose={() => setEditModalOpen(false)}
        onSubmit={handleEditCourseDetails}
      />

      {/* Delete Course Confirmation Modal */}
      <Modal
        open={deleteCourseModalOpen}
        title="Delete course?"
        description={`This will permanently delete "${targetCourse.code} — ${targetCourse.name}" along with all its topics, study materials, and share links.`}
        onClose={() => {
          if (!deletingCourse) setDeleteCourseModalOpen(false);
        }}
      >
        <div className="flex items-center justify-end gap-2.5 pt-2">
          <Button
            variant="secondary"
            onClick={() => setDeleteCourseModalOpen(false)}
            disabled={deletingCourse}
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => void handleConfirmDeleteCourse()}
            loading={deletingCourse}
          >
            Delete permanently
          </Button>
        </div>
      </Modal>
    </div>
  );
};
