/**
 * Where each admin screen came from, so its back button can be a real history step. Every screen is pushed, so the
 * system back gesture walks back through admin; the on-screen back button then has to pop the same entry, or the
 * history would fill with list, detail, list, detail. The button pops when the entry before this one is the screen
 * it names; otherwise (a deep link, a notification, a page reload) it replaces this entry with that screen.
 * 记录每个管理界面从哪里来，让返回按钮成为真正的历史后退。每个界面都是压入的，系统返回手势因此可以在管理后台中逐级返回；屏幕上的返回按钮
 * 也必须弹出同一条记录，否则历史里会堆满「列表、详情、列表、详情」。只有当前一条记录正是按钮所指的界面时才弹出；否则（直接打开的链接、
 * 通知、刷新页面）用那个界面替换当前记录。
 */

export type NavigationKind = 'PUSH' | 'POP' | 'REPLACE';

interface Visit {
  /** Pathname only; the query (search, filters) does not change which screen it is. */
  /** 只记路径；查询参数（搜索、筛选）不改变是哪个界面。 */
  path: string;
  parent: string | null;
  /** Reached by a push from outside admin, such as 发现 → 管理. */
  /** 从管理后台之外压入而来，例如「发现 → 管理」。 */
  fromOutside: boolean;
}

function pathOf(location: string): string {
  const cut = location.search(/[?#]/);
  return cut === -1 ? location : location.slice(0, cut);
}

export class AdminHistory {
  private visits = new Map<string, Visit>();
  private last: string | null = null;

  /** Called for every location admin shows, with the router's key and the kind of navigation that led there. */
  /** 管理后台显示的每个位置都会调用，传入路由的 key 以及到达这里的导航方式。 */
  record(key: string, location: string, kind: NavigationKind): void {
    const known = this.visits.get(key);
    if (known) {
      // Back or forward to an entry seen before; its query may have changed in place.
      // 返回或前进到之前见过的记录；它的查询参数可能已就地改变。
      known.path = pathOf(location);
      this.last = key;
      return;
    }
    const previous = this.last ? (this.visits.get(this.last) ?? null) : null;
    let parent: string | null = null;
    let fromOutside = false;
    if (kind === 'PUSH') {
      parent = this.last;
      fromOutside = this.last === null;
    } else if (kind === 'REPLACE' && previous) {
      // A replaced entry keeps the place of the one it replaced.
      // 被替换的记录沿用它所替换的那条记录的位置。
      parent = previous.parent;
      fromOutside = previous.fromOutside;
    }
    this.visits.set(key, { path: pathOf(location), parent, fromOutside });
    this.last = key;
  }

  /** Admin unmounted: whatever comes next is not a step from the last admin screen. */
  /** 管理后台已卸载：接下来的位置不再是从上一个管理界面迈出的一步。 */
  leave(): void {
    this.last = null;
  }

  /** True when going back one entry lands on `target` (a pathname), so the back button can pop. */
  /** 后退一条记录正好落在 `target`（路径）上时为 true，返回按钮因此可以弹出。 */
  canPopTo(key: string, target: string): boolean {
    const parent = this.visits.get(key)?.parent;
    if (!parent) return false;
    return this.visits.get(parent)?.path === pathOf(target);
  }

  /** True when this entry was pushed from outside admin, so going back one entry leaves admin. */
  /** 该记录是从管理后台之外压入时为 true，后退一条记录即离开管理后台。 */
  enteredFromOutside(key: string): boolean {
    return this.visits.get(key)?.fromOutside ?? false;
  }
}

export const adminHistory = new AdminHistory();
