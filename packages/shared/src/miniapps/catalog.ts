/** Projects published by the technology department. Add a record here to list another one. */
/** 技术部自己做的项目。再上一个，就在这里加一条。 */

export interface MiniApp {
  id: string;
  name: string;
  url: string;
  summary: string;
  recommended: boolean;
}

export const MINI_APPS: MiniApp[] = [
  {
    id: 'rufree',
    name: 'RUFREE',
    url: 'https://rufree.ca',
    summary: '共享课表。导入课程后，和朋友叠在一起看，找共同空闲，考试也能提醒。',
    recommended: true,
  },
];

export function findMiniApp(id: string): MiniApp | undefined {
  return MINI_APPS.find((app) => app.id === id);
}
