import { useEffect } from 'react';
import { ENROLLMENT_STATUSES, enrollmentCalendarYear, registrationYearRange, shouldGraduate, type EnrollmentStatus } from '@utmmsc/shared';
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

function yearsFor(status: EnrollmentStatus): number[] {
  const { min, max } = registrationYearRange(status);
  const years: number[] = [];
  for (let y = max; y >= min; y--) years.push(y);
  return years;
}

/**
 * Name, status, enrollment year and program. `fixedStatus` is the status the email address already
 * decides (mail.utoronto.ca, alumni.utoronto.ca); the status menu is then locked to it.
 * 姓名、在读状态、入学年份和专业。`fixedStatus` 是邮箱已经决定的状态（mail.utoronto.ca、alumni.utoronto.ca），此时状态菜单锁定为该值。
 */
export function ProfileFields({ value, onChange, fixedStatus = null }: { value: ProfileValues; onChange: (next: ProfileValues) => void; fixedStatus?: EnrollmentStatus | null }) {
  const { tr, enrollment } = useLabels();
  const year = Number(value.graduationYear);
  const graduated = Number.isInteger(year) && shouldGraduate(year, 'student');
  const status = graduated ? 'alumni' : (fixedStatus ?? value.enrollmentStatus);
  const years = yearsFor(status);
  const yearValue = years.includes(year) ? value.graduationYear : String(years.includes(enrollmentCalendarYear()) ? enrollmentCalendarYear() : years[0]);

  // Keep the stored status and year inside what the address and the year list allow, so the form submits what it shows.
  // 让保存的状态和年份始终在邮箱与年份列表允许的范围内，表单提交的就是显示的内容。
  useEffect(() => {
    if (value.enrollmentStatus !== status || value.graduationYear !== yearValue) {
      onChange({ ...value, enrollmentStatus: status, graduationYear: yearValue });
    }
  }, [status, yearValue, value, onChange]);

  function setYear(nextYear: string) {
    const parsed = Number(nextYear);
    onChange({
      ...value,
      graduationYear: nextYear,
      enrollmentStatus: shouldGraduate(parsed, 'student') ? 'alumni' : (fixedStatus ?? value.enrollmentStatus),
    });
  }

  return (
    <>
      <Field label={tr('姓名', 'Name')}>
        <TextInput autoComplete="name" placeholder={tr('真实姓名或常用名', 'Your real name or the name you go by')} value={value.displayName} onChange={(e) => onChange({ ...value, displayName: e.target.value })} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={tr('状态', 'Status')} hint={fixedStatus ? tr('由邮箱决定', 'Set by your email') : undefined}>
          <Select
            value={status}
            disabled={graduated || fixedStatus !== null}
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
          <Select value={yearValue} onChange={(e) => setYear(e.target.value)}>
            {years.map((y) => (
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
