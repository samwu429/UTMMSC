import { ENROLLMENT_STATUSES, enrollmentCalendarYear, enrollmentYearMax, enrollmentYearMin, shouldGraduate, type EnrollmentStatus } from '@utmmsc/shared';
import { useLabels } from '../../../shared/i18n/locale';
import { Field, Select, TextInput } from '../../../shared/ui/Field';
import { ProgramPicker } from './ProgramPicker';

export interface ProfileValues {
  displayName: string;
  enrollmentStatus: EnrollmentStatus;
  graduationYear: string;
  /** Null until the person chooses. An empty list is 尚未选择专业. */
  programs: string[] | null;
}

export const EMPTY_PROFILE: ProfileValues = {
  displayName: '',
  enrollmentStatus: 'student',
  graduationYear: String(enrollmentCalendarYear()),
  programs: null,
};

const YEARS: number[] = [];
for (let y = enrollmentYearMax(); y >= enrollmentYearMin(); y--) YEARS.push(y);

export function ProfileFields({ value, onChange }: { value: ProfileValues; onChange: (next: ProfileValues) => void }) {
  const { tr, enrollment } = useLabels();
  const year = Number(value.graduationYear);
  const graduated = Number.isInteger(year) && shouldGraduate(year, 'student');
  const status = graduated ? 'alumni' : value.enrollmentStatus;

  function setYear(nextYear: string) {
    const parsed = Number(nextYear);
    onChange({
      ...value,
      graduationYear: nextYear,
      enrollmentStatus: shouldGraduate(parsed, 'student') ? 'alumni' : value.enrollmentStatus,
    });
  }

  return (
    <>
      <Field label={tr('姓名', 'Name')}>
        <TextInput autoComplete="name" placeholder={tr('真实姓名或常用名', 'Your real name or the name you go by')} value={value.displayName} onChange={(e) => onChange({ ...value, displayName: e.target.value })} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={tr('状态', 'Status')}>
          <Select
            value={status}
            disabled={graduated}
            onChange={(e) => onChange({ ...value, enrollmentStatus: e.target.value as EnrollmentStatus })}
          >
            {ENROLLMENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {enrollment(s)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={tr('入学年份', 'Enrollment year')} hint={tr('登记后不能自行修改', 'You cannot change this yourself later')}>
          <Select value={value.graduationYear} onChange={(e) => setYear(e.target.value)}>
            {YEARS.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <ProgramPicker programs={value.programs} onChange={(programs) => onChange({ ...value, programs })} />
    </>
  );
}
