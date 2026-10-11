import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ENROLLMENT_LABELS, ROLE_LABELS, directRoomId, type MemberProfile } from '@utmmsc/shared';
import { errorMessage } from '../../../shared/api/errors';
import { useSessionStore } from '../../../shared/session/store';
import { Button } from '../../../shared/ui/Button';
import { Badge, Card, Notice, Spinner } from '../../../shared/ui/Card';
import { chatApi } from '../../chat/api';
import { directoryApi } from '../api';

export function MemberPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const self = useSessionStore((s) => s.member);
  const [member, setMember] = useState<MemberProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    directoryApi.get(id).then((res) => setMember(res.member)).catch((err) => setError(errorMessage(err)));
  }, [id]);

  async function openDirect() {
    setOpening(true);
    try {
      const res = await chatApi.openDirect(id);
      navigate(`/chat/room/${encodeURIComponent(directRoomId(res.conversationId))}`);
    } catch (err) {
      setError(errorMessage(err));
      setOpening(false);
    }
  }

  if (error) return <Notice tone="error">{error}</Notice>;
  if (!member) return <Spinner />;

  return (
    <div className="space-y-4">
      <Link to="/directory" className="text-sm text-brand-700">
        ← 返回成员列表
      </Link>
      <Card className="text-center">
        <div className="mx-auto mb-3 flex h-20 w-20 items-center justify-center rounded-full bg-brand-100 text-3xl font-semibold text-brand-800">
          {member.displayName.slice(0, 1)}
        </div>
        <h1 className="text-xl font-semibold">{member.displayName}</h1>
        <div className="mt-2 flex justify-center gap-2">
          <Badge>{member.graduationYear} 届</Badge>
          <Badge>{ENROLLMENT_LABELS[member.enrollmentStatus]}</Badge>
          <Badge tone="brand">{ROLE_LABELS[member.role]}</Badge>
        </div>
        {member.major ? <p className="mt-3 text-sm text-slate-600">{member.major}</p> : null}
      </Card>
      {self && self.id !== member.id ? (
        <Button block onClick={openDirect} loading={opening}>
          发私信
        </Button>
      ) : null}
    </div>
  );
}
