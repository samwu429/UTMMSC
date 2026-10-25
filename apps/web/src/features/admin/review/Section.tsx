import { Navigate, useLocation, useMatch, useSearchParams } from 'react-router-dom';
import { useSessionStore } from '../../../shared/session/store';
import { SplitView } from '../layout/SplitView';
import { ADMIN_HOME, sectionPath } from '../sections';
import { ReviewDetail } from './ReviewDetail';
import { ReviewList } from './ReviewList';
import { isReviewKind, readReviewKind, reviewKindsFor, reviewListPath } from './reviewQueue';

/**
 * /admin/review/*: the queue (?type=applications|years) and each item at /admin/review/:kind/:id, side by side from
 * 1280px. Any other address under it goes back to the queue.
 * /admin/review/*：队列（?type=applications|years）以及位于 /admin/review/:kind/:id 的每一项，从 1280px 起并排显示。其下的其他地址
 * 回到队列。
 */
export function ReviewSection() {
  const role = useSessionStore((s) => s.member?.role ?? 'student');
  const [params] = useSearchParams();
  const { pathname } = useLocation();
  const base = sectionPath('review');
  const match = useMatch(`${base}/:kind/:id`);
  const kinds = reviewKindsFor(role);
  const listKind = readReviewKind(params.get('type'), kinds);
  if (!listKind) return <Navigate to={ADMIN_HOME} replace />;

  const matchedKind = match?.params.kind;
  const detailKind = isReviewKind(matchedKind) && kinds.includes(matchedKind) ? matchedKind : null;
  const id = detailKind ? (match?.params.id ?? null) : null;
  const atList = pathname === base || pathname === `${base}/`;
  if (!atList && !id) return <Navigate to={reviewListPath(listKind)} replace />;

  const kind = detailKind ?? listKind;
  return (
    <SplitView
      detailOpen={id !== null}
      list={<ReviewList kinds={kinds} kind={kind} selectedId={id} />}
      detail={detailKind && id ? <ReviewDetail key={`${detailKind}:${id}`} kind={detailKind} id={id} /> : null}
    />
  );
}
