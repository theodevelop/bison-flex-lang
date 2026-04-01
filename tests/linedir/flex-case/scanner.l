/* Test case 3 — Flex scanner
   Commande : flex -o lex.yy.c scanner.l
   Génère   : lex.yy.c (dans tests/linedir/flex-case/)
   Test     : ouvrir lex.yy.c → Show in Source → doit revenir ici
              ouvrir scanner.l → Show in Generated File → doit ouvrir lex.yy.c */

%option noyywrap

%%

[0-9]+          { printf("NUMBER: %s\n", yytext); }
[a-zA-Z_]+      { printf("ID: %s\n", yytext); }
"+"             { printf("PLUS\n"); }
"-"             { printf("MINUS\n"); }
[ \t\n]+        { /* skip whitespace */ }
.               { printf("UNKNOWN: %s\n", yytext); }

%%
