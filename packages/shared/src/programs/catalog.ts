/**
 * UTM undergraduate specialist, major, and minor programs.
 * Departments and codes: https://utm.calendar.utoronto.ca/program-search
 * Department list cross-checked with https://www.utm.utoronto.ca/programs-and-departments/undergraduate-programs-and-departments
 * Certificates, focuses, and units with no specialist/major/minor are omitted.
 * Joint programs are listed under each calendar department that offers them.
 */

export const PROGRAM_LEVELS = ['specialist', 'major', 'minor'] as const;
export type ProgramLevel = (typeof PROGRAM_LEVELS)[number];

export const PROGRAM_LEVEL_LABELS: Record<ProgramLevel, string> = {
  specialist: '专业方向',
  major: '主修',
  minor: '辅修',
};

export const PROGRAM_AREAS = ['Arts', 'Science', 'BCom', 'BBA', 'HBA'] as const;
export type ProgramArea = (typeof PROGRAM_AREAS)[number];

export const PROGRAM_AREA_LABELS: Record<ProgramArea, string> = {
  Arts: '文学',
  Science: '理学',
  BCom: '商学',
  BBA: '工商管理',
  HBA: '荣誉文学',
};

export interface UtmDepartment {
  id: string;
  name: string;
  nameZh: string;
}

export interface UtmProgram {
  code: string;
  level: ProgramLevel;
  departmentIds: readonly string[];
  name: string;
  area: ProgramArea | null;
}

export const UTM_DEPARTMENTS: readonly UtmDepartment[] = [
  { id: 'anthropology', name: "Anthropology", nameZh: "人类学" },
  { id: 'biology', name: "Biology", nameZh: "生物学" },
  { id: 'chemical-and-physical-sciences', name: "Chemical and Physical Sciences", nameZh: "化学与物理科学" },
  { id: 'communication-culture-information-and-technology', name: "Communication, Culture, Information, & Technology", nameZh: "传播、文化、信息与技术" },
  { id: 'economics', name: "Economics", nameZh: "经济学" },
  { id: 'english-and-drama', name: "English and Drama", nameZh: "英语与戏剧" },
  { id: 'forensic-sciences', name: "Forensic Sciences", nameZh: "法医科学" },
  { id: 'geography-geomatics-and-environment', name: "Geography, Geomatics and Environment", nameZh: "地理、地理信息与环境" },
  { id: 'historical-studies', name: "Historical Studies", nameZh: "历史研究" },
  { id: 'language-studies', name: "Language Studies", nameZh: "语言研究" },
  { id: 'management', name: "Management", nameZh: "管理学" },
  { id: 'management-and-innovation', name: "Management and Innovation", nameZh: "管理与创新" },
  { id: 'mathematical-and-computational-sciences', name: "Mathematical and Computational Sciences", nameZh: "数学与计算科学" },
  { id: 'philosophy', name: "Philosophy", nameZh: "哲学" },
  { id: 'political-science', name: "Political Science", nameZh: "政治学" },
  { id: 'psychological-and-brain-sciences', name: "Psychological and Brain Sciences", nameZh: "心理与脑科学" },
  { id: 'sociology', name: "Sociology", nameZh: "社会学" },
  { id: 'visual-studies', name: "Visual Studies", nameZh: "视觉研究" },
];

export const UTM_PROGRAMS: readonly UtmProgram[] = [
  { code: 'ERSPE1775', level: 'specialist', departmentIds: ['anthropology'], name: "Anthropology", area: 'Arts' },
  { code: 'ERSPE0105', level: 'specialist', departmentIds: ['anthropology'], name: "Anthropology", area: 'Science' },
  { code: 'ERMAJ1775', level: 'major', departmentIds: ['anthropology'], name: "Anthropology", area: 'Arts' },
  { code: 'ERMAJ0105', level: 'major', departmentIds: ['anthropology'], name: "Anthropology", area: 'Science' },
  { code: 'ERMIN1775', level: 'minor', departmentIds: ['anthropology'], name: "Anthropology", area: 'Arts' },
  { code: 'ERSPE2364', level: 'specialist', departmentIds: ['biology'], name: "Biology", area: 'Science' },
  { code: 'ERSPE1118', level: 'specialist', departmentIds: ['biology'], name: "Biotechnology", area: 'Science' },
  { code: 'ERSPE0482', level: 'specialist', departmentIds: ['biology'], name: "Comparative Physiology", area: 'Science' },
  { code: 'ERSPE1020', level: 'specialist', departmentIds: ['biology'], name: "Ecology and Evolution", area: 'Science' },
  { code: 'ERSPE1237', level: 'specialist', departmentIds: ['biology'], name: "Molecular Biology", area: 'Science' },
  { code: 'ERMAJ2364', level: 'major', departmentIds: ['biology'], name: "Biology", area: 'Science' },
  { code: 'ERMAJ1149', level: 'major', departmentIds: ['biology'], name: "Biology for Health Sciences", area: 'Science' },
  { code: 'ERMAJ1004', level: 'major', departmentIds: ['biology'], name: "Paleontology", area: 'Science' },
  { code: 'ERMIN2364', level: 'minor', departmentIds: ['biology'], name: "Biology", area: 'Science' },
  { code: 'ERMIN0840', level: 'minor', departmentIds: ['biology'], name: "Biomedical Communications", area: 'Science' },
  { code: 'ERSPE1025', level: 'specialist', departmentIds: ['chemical-and-physical-sciences'], name: "Astronomical Sciences", area: 'Science' },
  { code: 'ERSPE1995', level: 'specialist', departmentIds: ['chemical-and-physical-sciences'], name: "Biological Chemistry", area: 'Science' },
  { code: 'ERSPE1944', level: 'specialist', departmentIds: ['chemical-and-physical-sciences'], name: "Biophysics", area: 'Science' },
  { code: 'ERSPE1376', level: 'specialist', departmentIds: ['chemical-and-physical-sciences'], name: "Chemistry", area: 'Science' },
  { code: 'ERSPE1465', level: 'specialist', departmentIds: ['chemical-and-physical-sciences'], name: "Earth Science", area: 'Science' },
  { code: 'ERSPE0509', level: 'specialist', departmentIds: ['chemical-and-physical-sciences'], name: "Geology", area: 'Science' },
  { code: 'ERMAJ2204', level: 'major', departmentIds: ['chemical-and-physical-sciences'], name: "Astronomy", area: 'Science' },
  { code: 'ERMAJ1376', level: 'major', departmentIds: ['chemical-and-physical-sciences'], name: "Chemistry", area: 'Science' },
  { code: 'ERMAJ1465', level: 'major', departmentIds: ['chemical-and-physical-sciences'], name: "Earth Science", area: 'Science' },
  { code: 'ERMAJ1944', level: 'major', departmentIds: ['chemical-and-physical-sciences'], name: "Physics", area: 'Science' },
  { code: 'ERMIN1376', level: 'minor', departmentIds: ['chemical-and-physical-sciences'], name: "Chemistry", area: 'Science' },
  { code: 'ERMIN1465', level: 'minor', departmentIds: ['chemical-and-physical-sciences'], name: "Earth Science", area: 'Science' },
  { code: 'ERMIN1944', level: 'minor', departmentIds: ['chemical-and-physical-sciences'], name: "Physics", area: 'Science' },
  { code: 'ERSPE1307', level: 'specialist', departmentIds: ['communication-culture-information-and-technology'], name: "Digital Enterprise Management", area: 'Arts' },
  { code: 'ERMAJ1034', level: 'major', departmentIds: ['communication-culture-information-and-technology'], name: "CCIT", area: 'Arts' },
  { code: 'ERMAJ1302', level: 'major', departmentIds: ['communication-culture-information-and-technology'], name: "Professional Writing and Communication", area: 'Arts' },
  { code: 'ERMAJ1040', level: 'major', departmentIds: ['communication-culture-information-and-technology'], name: "Technology, Coding & Society", area: 'Arts' },
  { code: 'ERMIN1302', level: 'minor', departmentIds: ['communication-culture-information-and-technology'], name: "Professional Writing and Communication", area: 'Arts' },
  { code: 'ERSPE1478', level: 'specialist', departmentIds: ['economics'], name: "Economics", area: 'Arts' },
  { code: 'ERSPE0137', level: 'specialist', departmentIds: ['economics'], name: "Economics", area: 'BCom' },
  { code: 'ERSPE0751', level: 'specialist', departmentIds: ['economics', 'political-science'], name: "Economics and Political Science", area: 'Arts' },
  { code: 'ERSPE2722', level: 'specialist', departmentIds: ['economics'], name: "Financial Economics", area: 'Science' },
  { code: 'ERSPE1384', level: 'specialist', departmentIds: ['economics'], name: "International Affairs", area: 'Arts' },
  { code: 'ERMAJ1478', level: 'major', departmentIds: ['economics'], name: "Economics", area: 'Arts' },
  { code: 'ERMIN1478', level: 'minor', departmentIds: ['economics'], name: "Economics", area: 'Arts' },
  { code: 'ERSPE1645', level: 'specialist', departmentIds: ['english-and-drama'], name: "English", area: 'Arts' },
  { code: 'ERSPE1880', level: 'specialist', departmentIds: ['english-and-drama'], name: "Theatre and Drama Studies", area: 'Arts' },
  { code: 'ERMAJ0728', level: 'major', departmentIds: ['english-and-drama'], name: "Canadian Studies", area: 'Arts' },
  { code: 'ERMAJ2468', level: 'major', departmentIds: ['english-and-drama'], name: "Dramaturgy and Drama Studies", area: 'Arts' },
  { code: 'ERMAJ1645', level: 'major', departmentIds: ['english-and-drama'], name: "English", area: 'Arts' },
  { code: 'ERMIN0728', level: 'minor', departmentIds: ['english-and-drama'], name: "Canadian Studies", area: 'Arts' },
  { code: 'ERMIN1497', level: 'minor', departmentIds: ['english-and-drama'], name: "Creative Writing", area: 'Arts' },
  { code: 'ERMIN2468', level: 'minor', departmentIds: ['english-and-drama'], name: "Dramaturgy and Drama Studies", area: 'Arts' },
  { code: 'ERMIN1645', level: 'minor', departmentIds: ['english-and-drama'], name: "English", area: 'Arts' },
  { code: 'ERMIN2023', level: 'minor', departmentIds: ['english-and-drama'], name: "Game Studies", area: 'Arts' },
  { code: 'ERSPE1338', level: 'specialist', departmentIds: ['forensic-sciences'], name: "Forensic Anthropology", area: 'Science' },
  { code: 'ERSPE1410', level: 'specialist', departmentIds: ['forensic-sciences'], name: "Forensic Biology", area: 'Science' },
  { code: 'ERSPE1009', level: 'specialist', departmentIds: ['forensic-sciences'], name: "Forensic Chemistry", area: 'Science' },
  { code: 'ERSPE1505', level: 'specialist', departmentIds: ['forensic-sciences'], name: "Forensic Psychology", area: 'Science' },
  { code: 'ERMAJ0205', level: 'major', departmentIds: ['forensic-sciences'], name: "Forensic Science", area: 'Science' },
  { code: 'ERMIN0205', level: 'minor', departmentIds: ['forensic-sciences'], name: "Forensic Science", area: 'Science' },
  { code: 'ERSPE1425', level: 'specialist', departmentIds: ['geography-geomatics-and-environment'], name: "Environmental Management", area: 'Arts' },
  { code: 'ERSPE1061', level: 'specialist', departmentIds: ['geography-geomatics-and-environment'], name: "Environmental Science", area: 'Science' },
  { code: 'ERSPE1666', level: 'specialist', departmentIds: ['geography-geomatics-and-environment'], name: "Geography", area: 'Arts' },
  { code: 'ERSPE2070', level: 'specialist', departmentIds: ['geography-geomatics-and-environment'], name: "Geography", area: 'Science' },
  { code: 'ERMAJ1425', level: 'major', departmentIds: ['geography-geomatics-and-environment'], name: "Environmental Management", area: 'Arts' },
  { code: 'ERMAJ1061', level: 'major', departmentIds: ['geography-geomatics-and-environment'], name: "Environmental Science", area: 'Science' },
  { code: 'ERMAJ1666', level: 'major', departmentIds: ['geography-geomatics-and-environment'], name: "Geography", area: 'Arts' },
  { code: 'ERMAJ2070', level: 'major', departmentIds: ['geography-geomatics-and-environment'], name: "Geography", area: 'Science' },
  { code: 'ERMAJ0305', level: 'major', departmentIds: ['geography-geomatics-and-environment'], name: "GeoSpatial Data Science", area: 'Science' },
  { code: 'ERMIN1392', level: 'minor', departmentIds: ['geography-geomatics-and-environment'], name: "Environmental Law and Policy", area: 'Arts' },
  { code: 'ERMIN1425', level: 'minor', departmentIds: ['geography-geomatics-and-environment'], name: "Environmental Management", area: 'Arts' },
  { code: 'ERMIN1061', level: 'minor', departmentIds: ['geography-geomatics-and-environment'], name: "Environmental Science", area: 'Science' },
  { code: 'ERMIN1666', level: 'minor', departmentIds: ['geography-geomatics-and-environment'], name: "Geography", area: 'Arts' },
  { code: 'ERMIN2070', level: 'minor', departmentIds: ['geography-geomatics-and-environment'], name: "Geography", area: 'Science' },
  { code: 'ERMIN0305', level: 'minor', departmentIds: ['geography-geomatics-and-environment'], name: "GeoSpatial Data Science", area: 'Science' },
  { code: 'ERMIN1670', level: 'minor', departmentIds: ['geography-geomatics-and-environment'], name: "Health, Environments, and Society", area: 'Arts' },
  { code: 'ERMIN1287', level: 'minor', departmentIds: ['geography-geomatics-and-environment'], name: "Sustainability", area: 'Arts' },
  { code: 'ERSPE0652', level: 'specialist', departmentIds: ['historical-studies'], name: "History", area: 'Arts' },
  { code: 'ERSPE1045', level: 'specialist', departmentIds: ['historical-studies', 'political-science'], name: "History and Political Science", area: 'Arts' },
  { code: 'ERSPE0151', level: 'specialist', departmentIds: ['historical-studies'], name: "History of Religions", area: 'Arts' },
  { code: 'ERMAJ0382', level: 'major', departmentIds: ['historical-studies'], name: "Classical Civilization", area: 'Arts' },
  { code: 'ERMAJ1407', level: 'major', departmentIds: ['historical-studies'], name: "Diaspora and Transnational Studies", area: 'Arts' },
  { code: 'ERMAJ0652', level: 'major', departmentIds: ['historical-studies'], name: "History", area: 'Arts' },
  { code: 'ERMAJ0151', level: 'major', departmentIds: ['historical-studies'], name: "History of Religions", area: 'Arts' },
  { code: 'ERMAJ1443', level: 'major', departmentIds: ['historical-studies'], name: "Women, Gender and Sexuality Studies", area: 'Arts' },
  { code: 'ERMIN0382', level: 'minor', departmentIds: ['historical-studies'], name: "Classical Civilization", area: 'Arts' },
  { code: 'ERMIN1407', level: 'minor', departmentIds: ['historical-studies'], name: "Diaspora and Transnational Studies", area: 'Arts' },
  { code: 'ERMIN0652', level: 'minor', departmentIds: ['historical-studies'], name: "History", area: 'Arts' },
  { code: 'ERMIN0151', level: 'minor', departmentIds: ['historical-studies'], name: "History of Religions", area: 'Arts' },
  { code: 'ERMIN0562', level: 'minor', departmentIds: ['historical-studies'], name: "Latin American and Caribbean Studies", area: 'Arts' },
  { code: 'ERMIN1333', level: 'minor', departmentIds: ['historical-studies'], name: "South Asian Humanities", area: 'Arts' },
  { code: 'ERMIN1443', level: 'minor', departmentIds: ['historical-studies'], name: "Women, Gender and Sexuality Studies", area: 'Arts' },
  { code: 'ERSPE1295', level: 'specialist', departmentIds: ['language-studies'], name: "French Studies", area: 'Arts' },
  { code: 'ERSPE2524', level: 'specialist', departmentIds: ['language-studies'], name: "Italian", area: 'Arts' },
  { code: 'ERSPE1092', level: 'specialist', departmentIds: ['language-studies'], name: "French and Italian", area: 'Arts' },
  { code: 'ERMAJ1295', level: 'major', departmentIds: ['language-studies'], name: "French Studies", area: 'Arts' },
  { code: 'ERMAJ2524', level: 'major', departmentIds: ['language-studies'], name: "Italian", area: 'Arts' },
  { code: 'ERMAJ1056', level: 'major', departmentIds: ['language-studies'], name: "French", area: 'Arts' },
  { code: 'ERMAJ1249', level: 'major', departmentIds: ['language-studies'], name: "Italian", area: 'Arts' },
  { code: 'ERMAJ1850', level: 'major', departmentIds: ['language-studies'], name: "Linguistic Studies", area: 'Arts' },
  { code: 'ERMIN2021', level: 'minor', departmentIds: ['language-studies'], name: "Chinese Language & Culture", area: 'Arts' },
  { code: 'ERMIN0605', level: 'minor', departmentIds: ['language-studies'], name: "Education Studies", area: 'Arts' },
  { code: 'ERMIN1200', level: 'minor', departmentIds: ['language-studies'], name: "English Language Linguistics", area: 'Arts' },
  { code: 'ERMIN1135', level: 'minor', departmentIds: ['language-studies'], name: "French Studies", area: 'Arts' },
  { code: 'ERMIN1000', level: 'minor', departmentIds: ['language-studies'], name: "Functional French", area: 'Arts' },
  { code: 'ERMIN0134', level: 'minor', departmentIds: ['language-studies'], name: "Global Leadership", area: 'Arts' },
  { code: 'ERMIN2524', level: 'minor', departmentIds: ['language-studies'], name: "Italian Language and Culture", area: 'Arts' },
  { code: 'ERMIN0506', level: 'minor', departmentIds: ['language-studies'], name: "Linguistic Studies", area: 'Arts' },
  { code: 'ERSPE2226', level: 'specialist', departmentIds: ['management'], name: "Accounting and Finance", area: 'BBA' },
  { code: 'ERSPE2273', level: 'specialist', departmentIds: ['management'], name: "Commerce", area: 'BCom' },
  { code: 'ERSPE1704', level: 'specialist', departmentIds: ['management'], name: "Accounting", area: 'BCom' },
  { code: 'ERSPE2034', level: 'specialist', departmentIds: ['management'], name: "Finance", area: 'BCom' },
  { code: 'ERSPE2380', level: 'specialist', departmentIds: ['management'], name: "Marketing", area: 'BCom' },
  { code: 'ERSPE1882', level: 'specialist', departmentIds: ['management'], name: "Human Resource Management", area: 'BBA' },
  { code: 'ERSPE2431', level: 'specialist', departmentIds: ['management'], name: "Management", area: 'BBA' },
  { code: 'ERMAJ1111', level: 'major', departmentIds: ['management'], name: "Commerce", area: 'HBA' },
  { code: 'ERMAJ2431', level: 'major', departmentIds: ['management'], name: "Management", area: 'HBA' },
  { code: 'ERMIN2017', level: 'minor', departmentIds: ['management-and-innovation'], name: "Business, Science and Entrepreneurship", area: 'Science' },
  { code: 'ERSPE1540', level: 'specialist', departmentIds: ['mathematical-and-computational-sciences'], name: "Applied Statistics", area: 'Science' },
  { code: 'ERSPE1868', level: 'specialist', departmentIds: ['mathematical-and-computational-sciences'], name: "Bioinformatics", area: 'Science' },
  { code: 'ERSPE1688', level: 'specialist', departmentIds: ['mathematical-and-computational-sciences'], name: "Computer Science", area: 'Science' },
  { code: 'ERSPE1038', level: 'specialist', departmentIds: ['mathematical-and-computational-sciences'], name: "Information Security", area: 'Science' },
  { code: 'ERSPE2511', level: 'specialist', departmentIds: ['mathematical-and-computational-sciences'], name: "Mathematical Sciences", area: 'Science' },
  { code: 'ERMAJ1540', level: 'major', departmentIds: ['mathematical-and-computational-sciences'], name: "Applied Statistics", area: 'Science' },
  { code: 'ERMAJ1688', level: 'major', departmentIds: ['mathematical-and-computational-sciences'], name: "Computer Science", area: 'Science' },
  { code: 'ERMAJ2512', level: 'major', departmentIds: ['mathematical-and-computational-sciences'], name: "Applied Mathematics", area: 'Science' },
  { code: 'ERMAJ2511', level: 'major', departmentIds: ['mathematical-and-computational-sciences'], name: "Mathematics", area: 'Science' },
  { code: 'ERMIN1540', level: 'minor', departmentIds: ['mathematical-and-computational-sciences'], name: "Applied Statistics", area: 'Science' },
  { code: 'ERMIN1688', level: 'minor', departmentIds: ['mathematical-and-computational-sciences'], name: "Computer Science", area: 'Science' },
  { code: 'ERMIN2511', level: 'minor', departmentIds: ['mathematical-and-computational-sciences'], name: "Mathematical Sciences", area: 'Science' },
  { code: 'ERSPE0231', level: 'specialist', departmentIds: ['philosophy'], name: "Philosophy", area: 'Arts' },
  { code: 'ERMAJ0231', level: 'major', departmentIds: ['philosophy'], name: "Philosophy", area: 'Arts' },
  { code: 'ERMIN1618', level: 'minor', departmentIds: ['philosophy'], name: "Ethics, Law and Society", area: 'Arts' },
  { code: 'ERMIN1011', level: 'minor', departmentIds: ['philosophy'], name: "Logic", area: 'Arts' },
  { code: 'ERMIN0231', level: 'minor', departmentIds: ['philosophy'], name: "Philosophy", area: 'Arts' },
  { code: 'ERMIN1370', level: 'minor', departmentIds: ['philosophy'], name: "Philosophy of Science", area: 'Arts' },
  { code: 'ERSPE2015', level: 'specialist', departmentIds: ['political-science'], name: "Political Science", area: 'Arts' },
  { code: 'ERMAJ2015', level: 'major', departmentIds: ['political-science'], name: "Political Science", area: 'Arts' },
  { code: 'ERMIN2015', level: 'minor', departmentIds: ['political-science'], name: "Political Science", area: 'Arts' },
  { code: 'ERSPE1883', level: 'specialist', departmentIds: ['psychological-and-brain-sciences'], name: "Exceptionality in Human Learning", area: 'Science' },
  { code: 'ERSPE2470', level: 'specialist', departmentIds: ['psychological-and-brain-sciences'], name: "Neuroscience", area: 'Science' },
  { code: 'ERSPE1160', level: 'specialist', departmentIds: ['psychological-and-brain-sciences'], name: "Psychology", area: 'Science' },
  { code: 'ERMAJ1160', level: 'major', departmentIds: ['psychological-and-brain-sciences'], name: "Psychology", area: 'Science' },
  { code: 'ERMIN1160', level: 'minor', departmentIds: ['psychological-and-brain-sciences'], name: "Psychology", area: 'Science' },
  { code: 'ERSPE0727', level: 'specialist', departmentIds: ['sociology'], name: "Criminology, Law & Society", area: 'Arts' },
  { code: 'ERSPE1013', level: 'specialist', departmentIds: ['sociology'], name: "Sociology", area: 'Arts' },
  { code: 'ERMAJ0727', level: 'major', departmentIds: ['sociology'], name: "Criminology, Law & Society", area: 'Arts' },
  { code: 'ERMAJ1013', level: 'major', departmentIds: ['sociology'], name: "Sociology", area: 'Arts' },
  { code: 'ERMIN0727', level: 'minor', departmentIds: ['sociology'], name: "Criminology, Law & Society", area: 'Arts' },
  { code: 'ERMIN1013', level: 'minor', departmentIds: ['sociology'], name: "Sociology", area: 'Arts' },
  { code: 'ERSPE0714', level: 'specialist', departmentIds: ['visual-studies'], name: "Art and Art History", area: 'Arts' },
  { code: 'ERSPE0615', level: 'specialist', departmentIds: ['visual-studies'], name: "Art History", area: 'Arts' },
  { code: 'ERSPE1200', level: 'specialist', departmentIds: ['visual-studies'], name: "Visual Culture and Communication", area: 'Arts' },
  { code: 'ERMAJ0714', level: 'major', departmentIds: ['visual-studies'], name: "Art and Art History", area: 'Arts' },
  { code: 'ERMAJ0615', level: 'major', departmentIds: ['visual-studies'], name: "Art History", area: 'Arts' },
  { code: 'ERMAJ0797', level: 'major', departmentIds: ['visual-studies'], name: "Cinema Studies", area: 'Arts' },
  { code: 'ERMIN0615', level: 'minor', departmentIds: ['visual-studies'], name: "Art History", area: 'Arts' },
  { code: 'ERMIN0797', level: 'minor', departmentIds: ['visual-studies'], name: "Cinema Studies", area: 'Arts' },
  { code: 'ERMIN1210', level: 'minor', departmentIds: ['visual-studies'], name: "Visual Culture", area: 'Arts' },
];

export const UTM_PROGRAMS_BY_CODE: ReadonlyMap<string, UtmProgram> = new Map(UTM_PROGRAMS.map((program) => [program.code, program]));

const LEVEL_RANK: Record<ProgramLevel, number> = { specialist: 0, major: 1, minor: 2 };

export function programsInDepartment(departmentId: string): UtmProgram[] {
  return UTM_PROGRAMS.filter((program) => program.departmentIds.includes(departmentId)).sort((a, b) => {
    const byLevel = LEVEL_RANK[a.level] - LEVEL_RANK[b.level];
    return byLevel || a.name.localeCompare(b.name) || a.code.localeCompare(b.code);
  });
}

export function programOptionLabel(program: UtmProgram): string {
  const area = program.area ? `（${PROGRAM_AREA_LABELS[program.area]}）` : '';
  return `${PROGRAM_LEVEL_LABELS[program.level]} · ${program.name}${area}`;
}

