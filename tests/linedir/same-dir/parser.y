/* Test case 1 — generated file in SAME directory as source
   Commande : bison -d parser.y
   Génère   : parser.tab.c (dans tests/linedir/same-dir/)
   Test     : ouvrir parser.tab.c, se mettre sur une ligne C → Show in Source
              doit sauter ici, à la ligne correspondante */

%{
#include <stdio.h>
int yylex(void);
void yyerror(const char *s);
%}

%token NUMBER PLUS MINUS TIMES DIVIDE

%%

expr:
    expr PLUS term     { $$ = $1 + $3; }
  | expr MINUS term    { $$ = $1 - $3; }
  | term               { $$ = $1; }
  ;

term:
    term TIMES factor  { $$ = $1 * $3; }
  | term DIVIDE factor { $$ = $1 / $3; }
  | factor             { $$ = $1; }
  ;

factor:
    NUMBER             { $$ = $1; }
  | '(' expr ')'       { $$ = $2; }
  ;

%%

void yyerror(const char *s) { fprintf(stderr, "error: %s\n", s); }
