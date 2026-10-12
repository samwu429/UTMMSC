import { ENROLLMENT_LABELS, ENROLLMENT_STATUSES, enrollmentCalendarYear, enrollmentYearMax, enrollmentYearMin, shouldGraduate, type EnrollmentStatus } from '@utmmsc/shared';
import { Field, Select, TextInput } from '../../../shared/ui/Field';

export interface ProfileValues {
  displayName: string;
  enrollmentStatus: EnrollmentStatus;
  graduationYear: string;
  major: string;
}

export const EMPTY_PROFILE: ProfileValues = {
  displayName: '',
  enrollmentStatus: 'student',
  graduationYear: String(enrollmentCalendarYear()),
  major: '',
};

const YEARS: number[] = [];
for (let y = enrollmentYearMax(); y >= enrollmentYearMin(); y--) YEARS.push(y);

export function ProfileFields({ value, onChange }: { value: ProfileValues; onChange: (next: ProfileValues) => void }) {
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
      <Field label="姓名">
        <TextInput autoComplete="name" placeholder="真实姓名或常用名" value={value.displayName} onChange={(e) => onChange({ ...value, displayName: e.target.value })} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="状态">
          <Select
            value={status}
            disabled={graduated}
            onChange={(e) => onChange({ ...value, enrollmentStatus: e.target.value as EnrollmentStatus })}
          >
            {ENROLLMENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {ENROLLMENT_LABELS[s]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="入学年份" hint="登记后不能自行修改">
          <Select value={value.graduationYear} onChange={(e) => setYear(e.target.value)}>
            {YEARS.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="专业（选填）">
        <TextInput placeholder="例如 Computer Science" value={value.major} onChange={(e) => onChange({ ...value, major: e.target.value })} />
      </Field>
    </>
  );
}
