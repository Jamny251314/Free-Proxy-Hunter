import { Button, Tooltip } from 'tdesign-react';
import type { ReactNode } from 'react';
import { AddIcon, DeleteIcon, SettingIcon } from 'tdesign-icons-react';
import { Bot, MessageSquare, Server } from 'lucide-react';
import { APP_CONFIG } from '../config';
import { Session, Agent } from '../types';
import { ICON_MAP } from '../utils/iconMap';

interface SidebarProps {
  sessions: Session[];
  currentSessionId: string | null;
  isSettingsPage: boolean;
  isProxyPage: boolean;
  sidebarOpen: boolean;
  agents: Agent[];
  getAgent: (id: string) => Agent | undefined;
  /** 侧边栏徽标：当前可用代理数量 */
  proxyAlive: number;
  onNewChat: () => void;
  onSelectSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
  onOpenSettings: () => void;
  onOpenProxy: () => void;
  onOpenChat: () => void;
}

interface NavItemProps {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
  badge?: number;
}

function NavItem({ active, icon, label, onClick, badge }: NavItemProps) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-colors duration-200 w-full"
      style={{
        backgroundColor: active ? 'var(--td-brand-color-light)' : 'transparent',
        color: active ? 'var(--td-brand-color)' : 'var(--td-text-color-secondary)',
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.backgroundColor = 'var(--td-bg-color-component-hover)';
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.backgroundColor = 'transparent';
      }}
    >
      <span className="shrink-0 flex items-center">{icon}</span>
      <span className="flex-1 text-sm font-medium truncate">{label}</span>
      {badge != null && badge > 0 && (
        <span
          className="shrink-0 text-[11px] px-1.5 py-0.5 rounded-full tabular-nums"
          style={{ backgroundColor: 'var(--td-brand-color)', color: '#fff' }}
        >
          {badge}
        </span>
      )}
    </button>
  );
}

export function Sidebar({
  sessions,
  currentSessionId,
  isSettingsPage,
  isProxyPage,
  sidebarOpen,
  getAgent,
  proxyAlive,
  onNewChat,
  onSelectSession,
  onDeleteSession,
  onOpenSettings,
  onOpenProxy,
  onOpenChat,
}: SidebarProps) {
  const inChat = !isSettingsPage && !isProxyPage;

  return (
    <aside
      className="flex flex-col flex-shrink-0 transition-all duration-300 overflow-hidden"
      style={{
        width: sidebarOpen ? 260 : 0,
        backgroundColor: 'var(--td-bg-color-container)'
      }}
    >
      {/* Logo */}
      <div className="h-14 px-4 flex items-center flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ backgroundColor: 'var(--td-brand-color)' }}
          >
            <span className="text-white text-sm font-bold">{APP_CONFIG.nameInitial}</span>
          </div>
          <span
            className="text-lg font-semibold"
            style={{ color: 'var(--td-text-color-primary)' }}
          >
            {APP_CONFIG.name}
          </span>
        </div>
      </div>

      {/* 主导航 */}
      <div className="px-3 pb-1 flex flex-col gap-1">
        <NavItem
          active={inChat}
          icon={<MessageSquare size={16} />}
          label="Agent 对话"
          onClick={onOpenChat}
        />
        <NavItem
          active={isProxyPage}
          icon={<Server size={16} />}
          label="免费代理池"
          badge={proxyAlive}
          onClick={onOpenProxy}
        />
      </div>

      {/* 新对话按钮 */}
      <div className="p-3">
        <Button
          icon={<AddIcon />}
          onClick={onNewChat}
          block
          variant="outline"
        >
          新对话
        </Button>
      </div>

      {/* 会话列表 */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {sessions.map(session => {
          const sessionAgent = session.agentId ? getAgent(session.agentId) : getAgent('default');
          const AgentIcon = ICON_MAP[sessionAgent?.icon || 'Bot'] || Bot;
          return (
            <div
              key={session.id}
              className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg cursor-pointer transition-colors duration-200 group"
              style={{
                backgroundColor: session.id === currentSessionId && inChat
                  ? 'var(--td-brand-color-light)'
                  : 'transparent',
                color: session.id === currentSessionId && inChat
                  ? 'var(--td-brand-color)'
                  : 'var(--td-text-color-secondary)'
              }}
              onClick={() => onSelectSession(session.id)}
              onMouseEnter={(e) => {
                if (session.id !== currentSessionId || !inChat) {
                  e.currentTarget.style.backgroundColor = 'var(--td-bg-color-component-hover)';
                }
              }}
              onMouseLeave={(e) => {
                if (session.id !== currentSessionId || !inChat) {
                  e.currentTarget.style.backgroundColor = 'transparent';
                }
              }}
            >
              <div
                className="flex-shrink-0 w-5 h-5 rounded flex items-center justify-center"
                style={{ backgroundColor: sessionAgent?.color || 'var(--td-brand-color)' }}
              >
                <AgentIcon size={12} color="white" />
              </div>
              <span className="flex-1 truncate text-sm">{session.title}</span>
              <Tooltip content="删除会话">
                <Button
                  className="opacity-0 group-hover:opacity-100 transition-opacity"
                  variant="text"
                  shape="circle"
                  size="medium"
                  icon={<DeleteIcon />}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteSession(session.id);
                  }}
                />
              </Tooltip>
            </div>
          );
        })}
      </div>

      {/* 底部设置按钮 */}
      <div
        className="p-3 border-t flex-shrink-0"
        style={{ borderColor: 'var(--td-component-border)' }}
      >
        <Button
          icon={<SettingIcon />}
          onClick={onOpenSettings}
          block
          variant={isSettingsPage ? 'outline' : 'text'}
          theme={isSettingsPage ? 'primary' : 'default'}
        >
          设置
        </Button>
      </div>
    </aside>
  );
}
