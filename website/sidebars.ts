import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  tutorialSidebar: [
    'intro',
    {
      type: 'category',
      label: 'Getting Started',
      items: [
        'getting-started/installation',
        'getting-started/supported-files',
        'getting-started/configuration',
      ],
    },
    {
      type: 'category',
      label: 'Stable Features',
      link: {type: 'doc', id: 'features/index'},
      items: [
        'features/syntax-highlighting',
        'features/diagnostics',
        'features/quick-fixes',
        'features/autocompletion',
        'features/hover-documentation',
        'features/snippets',
        'features/navigation',
        'features/cmake-integration',
        'features/grammar-tools',
        'features/compile-integration',
      ],
    },
    {
      type: 'category',
      label: 'Learn',
      link: {type: 'doc', id: 'learn/index'},
      items: [
        'learn/bison-basics',
        'learn/flex-basics',
        'learn/reflex-basics',
        'learn/bison-flex-workflow',
        'learn/common-errors',
      ],
    },
    {
      type: 'category',
      label: 'Language Reference',
      link: {type: 'doc', id: 'language-reference/index'},
      items: [
        {
          type: 'category',
          label: 'Bison',
          items: [
            'language-reference/bison/overview',
            'language-reference/bison/file-structure',
            'language-reference/bison/declarations',
            'language-reference/bison/grammar-rules',
            'language-reference/bison/semantic-values',
            'language-reference/bison/precedence',
            'language-reference/bison/conflicts',
          ],
        },
        {
          type: 'category',
          label: 'Flex',
          items: [
            'language-reference/flex/overview',
            'language-reference/flex/file-structure',
            'language-reference/flex/patterns',
            'language-reference/flex/actions',
            'language-reference/flex/start-conditions',
            'language-reference/flex/options',
          ],
        },
        {
          type: 'category',
          label: 'RE-flex',
          items: [
            'language-reference/reflex/overview',
            'language-reference/reflex/reflex-vs-flex',
            'language-reference/reflex/options',
            'language-reference/reflex/cxx-scanners',
          ],
        },
      ],
    },
    {
      type: 'category',
      label: 'Examples',
      link: {type: 'doc', id: 'examples/index'},
      items: [
        'examples/calculator-bison-flex',
        'examples/typed-semantic-values',
        'examples/start-conditions',
        'examples/cmake-project',
      ],
    },
    {
      type: 'category',
      label: 'Workbench V2 Preview',
      link: {type: 'doc', id: 'workbench-v2/index'},
      items: [
        'workbench-v2/project-model',
        'workbench-v2/compiler-diagnostics',
        'workbench-v2/conflict-explorer',
        'workbench-v2/token-flow',
        'workbench-v2/roadmap',
      ],
    },
    {
      type: 'category',
      label: 'Extension Reference',
      items: [
        'reference/commands',
        'reference/settings',
        'reference/diagnostic-codes',
        'reference/official-resources',
      ],
    },
  ],
};

export default sidebars;
