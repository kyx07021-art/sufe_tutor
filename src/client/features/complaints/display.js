/**
 * complaints domain display mappings (V-2-4b: moved out of core/display.js).
 * Pure functions; text from constants/text.js single source only.
 * Feedback/complaint kind + target labels are consumed by both posts (feedback
 * entry modal) and complaints features.
 */
import { TEXT } from '../../constants/text.js';

// U-3h M2: single-source bug predicate (L2: admin feedback-card warning edge + kind tag
// styling must not duplicate the kind->style mapping; also used internally below).
export const isFeedbackBug = kind => kind === 'bug';

export function feedbackKindName(kind) {
  if (isFeedbackBug(kind)) return TEXT.FEEDBACK_TAG_BUG;
  if (kind === 'complaint') return TEXT.FEEDBACK_TAG_COMPLAINT;
  return TEXT.FEEDBACK_TAG_SUGGEST;
}
export function feedbackSubjectName(subject) {
  if (subject === 'teacher') return TEXT.FEEDBACK_COMPLAINT_SUBJECT_TEACHER;
  if (subject === 'student') return TEXT.FEEDBACK_COMPLAINT_SUBJECT_STUDENT;
  if (subject === 'platform') return TEXT.FEEDBACK_COMPLAINT_SUBJECT_PLATFORM;
  return '';
}
export function feedbackKindCls(kind) {
  return isFeedbackBug(kind) ? 'tag-danger' : kind === 'complaint' ? 'tag-warn' : 'tag-accent';
}
export function complaintTargetName(targetType) {
  if (targetType === 'teacher') return TEXT.COMPLAINT_TAB_TEACHER;
  if (targetType === 'student') return TEXT.COMPLAINT_TAB_STUDENT;
  return TEXT.COMPLAINT_TAB_POST;
}
