import clsx from 'clsx';
import Heading from '@theme/Heading';
import Layout from '@theme/Layout';
import Link from '@docusaurus/Link';
import styles from './index.module.css';

type Card = {
  title: string;
  description: string;
  href: string;
  status?: 'Stable' | 'Preview';
};

const stableFeatures: Card[] = [
  {title: 'Syntax highlighting', description: 'Section-aware highlighting for Bison, Flex, RE-flex, and embedded C or C++.', href: '/docs/features/syntax-highlighting'},
  {title: 'Diagnostics', description: 'Fast feedback for missing separators, unknown directives, unused symbols, and common grammar mistakes.', href: '/docs/features/diagnostics'},
  {title: 'Quick fixes', description: 'Lightbulb actions for missing declarations, section separators, start conditions, and cleanup tasks.', href: '/docs/features/quick-fixes'},
  {title: 'Autocompletion', description: 'Directive, option, token, non-terminal, semantic value, and snippet suggestions.', href: '/docs/features/autocompletion'},
  {title: 'Hover documentation', description: 'Inline explanations for directives, options, semantic values, and project symbols.', href: '/docs/features/hover-documentation'},
  {title: 'Snippets', description: 'Small templates for grammar files, scanner files, rules, handlers, and declarations.', href: '/docs/features/snippets'},
  {title: 'Source/generated navigation', description: 'Move between grammar sources and generated C or C++ output using line directives.', href: '/docs/features/navigation'},
  {title: 'CMake integration', description: 'Detect missing BISON_TARGET and FLEX_TARGET entries and add target snippets.', href: '/docs/features/cmake-integration'},
  {title: 'Grammar tools', description: 'Inspect graphs, parse tables, conflicts, AST skeletons, and Flex rules.', href: '/docs/features/grammar-tools'},
  {title: 'Compile integration', description: 'Run Bison or Flex from VS Code and initialize build tasks with problem matchers.', href: '/docs/features/compile-integration'},
];

const previewFeatures: Card[] = [
  {title: 'Project model', description: 'A workspace index that understands parser files, scanner files, generated outputs, and build systems.', href: '/docs/workbench-v2/project-model', status: 'Preview'},
  {title: 'Compiler-backed diagnostics', description: 'A planned hybrid mode that combines fast static checks with compiler output on save or command.', href: '/docs/workbench-v2/compiler-diagnostics', status: 'Preview'},
  {title: 'Conflict explorer', description: 'A richer view over Bison report files, states, involved rules, and likely fixes.', href: '/docs/workbench-v2/conflict-explorer', status: 'Preview'},
  {title: 'Token flow analysis', description: 'Cross-file analysis for tokens declared in Bison and returned by Flex or RE-flex scanners.', href: '/docs/workbench-v2/token-flow', status: 'Preview'},
  {title: 'Rich grammar visualizations', description: 'Workbench-oriented views for understanding grammar shape, automata, and lexer behavior.', href: '/docs/workbench-v2/roadmap', status: 'Preview'},
];

const learnCards: Card[] = [
  {title: 'Learn Bison', description: 'Build a practical mental model for declarations, rules, values, and conflicts.', href: '/docs/learn/bison-basics'},
  {title: 'Learn Flex', description: 'Understand patterns, actions, start conditions, and scanner structure.', href: '/docs/learn/flex-basics'},
  {title: 'Learn RE-flex', description: 'Learn where RE-flex extends Flex-style scanner work for C++ projects.', href: '/docs/learn/reflex-basics'},
  {title: 'Bison + Flex workflow', description: 'See how parser and scanner files cooperate in a small project.', href: '/docs/learn/bison-flex-workflow'},
  {title: 'Examples', description: 'Start from compact, original examples that are easy to adapt.', href: '/docs/examples'},
];

function FeatureCard({card, preview = false}: {card: Card; preview?: boolean}) {
  return (
    <Link className={clsx(styles.card, preview && styles.previewCard)} to={card.href}>
      <span className={clsx(styles.badge, preview ? styles.previewBadge : styles.stableBadge)}>
        {card.status ?? 'Stable'}
      </span>
      <Heading as="h3">{card.title}</Heading>
      <p>{card.description}</p>
    </Link>
  );
}

function Section({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <span>{eyebrow}</span>
        <Heading as="h2">{title}</Heading>
        <p>{description}</p>
      </div>
      {children}
    </section>
  );
}

export default function Home(): JSX.Element {
  return (
    <Layout
      title="Bison/Flex Language Support"
      description="Modern VS Code tooling for GNU Bison, Flex, and RE-flex.">
      <main>
        <section className={styles.hero}>
          <div className={styles.heroContent}>
            <span className={styles.productTag}>VS Code extension docs</span>
            <Heading as="h1">Bison/Flex Language Support</Heading>
            <p className={styles.subtitle}>Modern VS Code tooling for GNU Bison, Flex, and RE-flex.</p>
            <div className={styles.ctas}>
              <Link className={clsx('button button--primary', styles.primaryCta)} to="/docs/intro">
                Get Started
              </Link>
              <Link className={clsx('button button--secondary', styles.secondaryCta)} to="/docs/workbench-v2">
                Explore Workbench V2
              </Link>
            </div>
          </div>
          <div className={styles.heroPanel} aria-label="Workbench preview">
            <div className={styles.panelTop}>
              <span>parser.y</span>
              <span>scanner.l</span>
              <span>build/output</span>
            </div>
            <div className={styles.diagram}>
              <div className={styles.node}>%token NUMBER</div>
              <div className={styles.line} />
              <div className={styles.node}>[0-9]+ return NUMBER;</div>
              <div className={styles.line} />
              <div className={styles.nodeAccent}>diagnostics + navigation</div>
            </div>
          </div>
        </section>

        <Section
          eyebrow="Stable V1"
          title="Current extension features"
          description="These pages describe behavior available in the current Bison/Flex Language Support extension.">
          <div className={styles.grid}>
            {stableFeatures.map((card) => (
              <FeatureCard key={card.title} card={card} />
            ))}
          </div>
        </Section>

        <Section
          eyebrow="Workbench V2"
          title="Preview direction"
          description="These pages describe the planned Bison/Flex Workbench direction. They are roadmap material, not released features.">
          <div className={styles.grid}>
            {previewFeatures.map((card) => (
              <FeatureCard key={card.title} card={card} preview />
            ))}
          </div>
        </Section>

        <Section
          eyebrow="Learn"
          title="Build the compiler-tooling mental model"
          description="Short, practical guides for parser and scanner work without replacing the official manuals.">
          <div className={styles.learnGrid}>
            {learnCards.map((card) => (
              <Link className={styles.learnCard} key={card.title} to={card.href}>
                <Heading as="h3">{card.title}</Heading>
                <p>{card.description}</p>
              </Link>
            ))}
          </div>
        </Section>
      </main>
    </Layout>
  );
}
