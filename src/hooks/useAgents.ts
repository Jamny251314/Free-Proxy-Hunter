import { useState, useEffect, useCallback } from 'react';
import { CustomAgent } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { apiUrl } from '../api';

const STORAGE_KEY = 'customAgents';

/**
 * 默认 Agent
 * systemPrompt 会在挂载时从后端 /api/proxy/agent-prompt 拉取，
 * 保证服务端与前端使用同一份权威提示词（见 server/prompt.ts）。
 */
const DEFAULT_AGENT: CustomAgent = {
  id: 'default',
  name: '代理猎手',
  description: '全网免费 IP 代理采集 / 测速验证 / Clash Verge 一体化运营专家',
  systemPrompt:
    '你是「代理猎手」，负责采集全网免费 IP 代理、测速验证、运行时同步更新，并整合为可直接导入 Clash Verge 的配置。优先复用应用内置的代理池接口，不要凭空编造 IP 与延迟数据。',
  icon: 'Bot',
  color: '#0052d9',
  createdAt: new Date(),
  updatedAt: new Date(),
};

export function useAgents() {
  const [agents, setAgents] = useState<CustomAgent[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        return [DEFAULT_AGENT, ...parsed.map((a: any) => ({
          ...a,
          createdAt: new Date(a.createdAt),
          updatedAt: new Date(a.updatedAt),
        }))];
      }
    } catch (e) {
      console.error('Failed to load agents:', e);
    }
    return [DEFAULT_AGENT];
  });

  // 从后端拉取权威提示词，替换默认 Agent 的 systemPrompt（单一事实来源）
  useEffect(() => {
    let cancelled = false;
    fetch(apiUrl('/api/proxy/agent-prompt'))
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { prompt?: string; name?: string } | null) => {
        if (cancelled || !data?.prompt) return;
        setAgents((prev) =>
          prev.map((a) =>
            a.id === 'default'
              ? { ...a, systemPrompt: data.prompt!, name: data.name ?? a.name }
              : a,
          ),
        );
      })
      .catch(() => {
        /* 拉取失败时沿用内置兜底提示词 */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 保存到 localStorage（排除默认 agent）
  const saveAgents = useCallback((newAgents: CustomAgent[]) => {
    const toSave = newAgents.filter(a => a.id !== 'default');
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
  }, []);

  const addAgent = useCallback((agent: Omit<CustomAgent, 'id' | 'createdAt' | 'updatedAt'>) => {
    const newAgent: CustomAgent = {
      ...agent,
      id: uuidv4(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    setAgents(prev => {
      const updated = [...prev, newAgent];
      saveAgents(updated);
      return updated;
    });
    return newAgent;
  }, [saveAgents]);

  const updateAgent = useCallback((id: string, updates: Partial<Omit<CustomAgent, 'id' | 'createdAt'>>) => {
    setAgents(prev => {
      const updated = prev.map(a => 
        a.id === id ? { ...a, ...updates, updatedAt: new Date() } : a
      );
      saveAgents(updated);
      return updated;
    });
  }, [saveAgents]);

  const deleteAgent = useCallback((id: string) => {
    if (id === 'default') return; // 不能删除默认 agent
    setAgents(prev => {
      const updated = prev.filter(a => a.id !== id);
      saveAgents(updated);
      return updated;
    });
  }, [saveAgents]);

  const getAgent = useCallback((id: string) => {
    return agents.find(a => a.id === id);
  }, [agents]);

  return {
    agents,
    addAgent,
    updateAgent,
    deleteAgent,
    getAgent,
    defaultAgent: DEFAULT_AGENT,
  };
}
