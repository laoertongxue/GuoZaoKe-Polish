export interface Topic {
  id: string; url: string; title: string; author: string; avatar: string;
  node: string; replies: number; time: string;
}
export interface TopicDetail extends Topic { html: string; text: string; }
export interface Reply {
  id: string; floor: number; author: string; avatar: string; html: string; text: string;
  likes: number; mentions: string[]; references: number[]; element: HTMLElement;
}
export interface ReadingItem extends Topic { addedAt: number; read: boolean; }
export interface MemberInfo { username: string; avatar: string; description: string; url: string; }
export interface Notice { text: string; url: string; }
export interface Account { username: string; unread: number; }
