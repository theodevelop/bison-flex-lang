import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'Bison/Flex Language Support',
  tagline: 'Modern VS Code tooling for GNU Bison, Flex, and RE-flex.',
  favicon: 'img/favicon.svg',

  url: 'https://theodevelop.github.io',
  baseUrl: '/bison-flex-lang/',
  organizationName: 'theodevelop',
  projectName: 'bison-flex-lang',
  trailingSlash: false,

  onBrokenLinks: 'throw',
  markdown: {
    hooks: {
      onBrokenMarkdownLinks: 'warn',
    },
  },

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          routeBasePath: 'docs',
          editUrl: 'https://github.com/theodevelop/bison-flex-lang/tree/dev/website/',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: 'img/social-card.svg',
    navbar: {
      title: 'Bison/Flex',
      logo: {
        alt: 'Bison/Flex Language Support',
        src: 'img/logo.svg',
      },
      items: [
        {type: 'docSidebar', sidebarId: 'tutorialSidebar', position: 'left', label: 'Docs'},
        {to: '/docs/features', label: 'Features', position: 'left'},
        {to: '/docs/learn', label: 'Learn', position: 'left'},
        {to: '/docs/language-reference', label: 'Language Reference', position: 'left'},
        {to: '/docs/workbench-v2', label: 'V2 Workbench', position: 'left'},
        {to: '/docs/examples', label: 'Examples', position: 'left'},
        {
          href: 'https://github.com/theodevelop/bison-flex-lang',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            {label: 'Getting Started', to: '/docs/intro'},
            {label: 'Stable Features', to: '/docs/features'},
            {label: 'Workbench V2', to: '/docs/workbench-v2'},
          ],
        },
        {
          title: 'Reference',
          items: [
            {label: 'Commands', to: '/docs/reference/commands'},
            {label: 'Settings', to: '/docs/reference/settings'},
            {label: 'Official Resources', to: '/docs/reference/official-resources'},
          ],
        },
        {
          title: 'Project',
          items: [
            {label: 'GitHub', href: 'https://github.com/theodevelop/bison-flex-lang'},
            {label: 'Marketplace', href: 'https://marketplace.visualstudio.com/items?itemName=theodevelop.bison-flex-lang'},
            {label: 'Open VSX', href: 'https://open-vsx.org/extension/theodevelop/bison-flex-lang'},
          ],
        },
      ],
      copyright: `Copyright ${new Date().getFullYear()} Bison/Flex Language Support contributors.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['bash', 'cmake', 'json', 'cpp'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
