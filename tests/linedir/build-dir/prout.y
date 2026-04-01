/* Test case 2 — generated file in a BUILD subdirectory
   Commande : bison -d -o build/parser.tab.c parser.y
   Génère   : build/parser.tab.c
   Test 1   : ouvrir build/parser.tab.c → Show in Source → doit revenir ici
   Test 2   : ouvrir parser.y → Show in Generated File
              SANS setting : doit échouer (pas dans le même dossier)
              AVEC bisonFlex.buildDirectory = "tests/linedir/build-dir/build" : doit trouver */

%{
#include <stdio.h>
int yylex(void);
void yyerror(const char *s);
%}

%token ID ASSIGN SEMI

%%

program:
    stmts
  ;

stmts:
    stmts stmt
  | stmt
  ;

stmt:
    ID ASSIGN ID SEMI  { printf("assign\n"); }
  | ID SEMI            { printf("expr stmt\n"); }
  ;

%%

void yyerror(const char *s) { fprintf(stderr, "error: %s\n", s); }
