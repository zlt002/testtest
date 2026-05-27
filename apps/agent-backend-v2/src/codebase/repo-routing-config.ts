export type PageCodebaseRule = {
  id: string;
  businessId?: string;
  pageLabel?: string;
  triggerSkill?: string;
  ewankbKb?: string;
  ewankbMode?: 'graph' | 'kb' | 'deep';
  minimumScore?: number;
  enabled?: boolean;
  hostIncludes?: string[];
  pathnameIncludes?: string[];
  hashRouteIncludes?: string[];
  pageTextIncludes?: string[];
  apiPrefixes?: string[];
  resourceHintIncludes?: string[];
  frontendGraphProjects: string[];
  backendGraphProjects: string[];
  sharedGraphProjects?: string[];
};

export const PAGE_CODEBASE_RULES: PageCodebaseRule[] = [
  {
    id: 'otp-receipt',
    businessId: 'otp',
    pageLabel: '回单管理',
    triggerSkill: '/ewankb-server-query',
    ewankbKb: 'otp',
    ewankbMode: 'graph',
    hostIncludes: ['an-uat.annto.com'],
    hashRouteIncludes: ['/distribute/receipt-mngt'],
    pageTextIncludes: ['回单管理', '监控'],
    apiPrefixes: ['/api-tms/receipt/'],
    frontendGraphProjects: [
      'Users-zhanglt21-Desktop-codebase-otp-pc',
      'Users-zhanglt21-Desktop-codebase-otp-pc2',
    ],
    backendGraphProjects: [
      'Users-zhanglt21-Desktop-codebase-t-tms',
      'Users-zhanglt21-Desktop-codebase-logistics-otp',
    ],
    sharedGraphProjects: ['Users-zhanglt21-Desktop-codebase-tms-components-v3'],
  },
  {
    id: 'ntp-platform',
    businessId: 'ntp',
    pageLabel: '运力调度',
    triggerSkill: '/ewankb-server-query',
    ewankbKb: 'ntp',
    ewankbMode: 'graph',
    minimumScore: 7,
    hostIncludes: ['an-uat.annto.com'],
    hashRouteIncludes: ['/ntp/transport'],
    pageTextIncludes: ['线路', '运力', '调度'],
    apiPrefixes: ['/api-ntp/', '/api-transport/'],
    frontendGraphProjects: [
      'Users-zhanglt21-Desktop-codebase-ntp-platform-pc',
      'Users-zhanglt21-Desktop-codebase-ntp-transport-mp',
    ],
    backendGraphProjects: ['Users-zhanglt21-Desktop-codebase-logistics-ntp'],
    sharedGraphProjects: ['Users-zhanglt21-Desktop-codebase-tms-components-v3'],
  },
];
