# Recursos visuais

Os recursos Carbon foram adaptados do [Carbon Design System](https://github.com/carbon-design-system/carbon), commit `358cc1ece70f75618f41444751142d42b4c16bf0`. A licença Apache-2.0 está em [LICENSE](LICENSE).

| Arquivo | Origem e adaptação |
|---|---|
| `tokens.css` | Tokens de cores, temas g10/g100 e botões dos arquivos DTCG do Carbon |
| `icons.tsx` | Geometrias de `packages/icons/src/svg/32`, com adaptador React local |
| `palette.ts` | Cores de veículos selecionadas de `packages/colors/src/dtcg/colors.json` |
| `components.tsx` | Adaptações de `ButtonBase.tsx` e `UIShell/Header.tsx` |
| `components.css` | Regras de botões e cabeçalho adaptadas do Sass do Carbon |

`carbon-theme.css` e `studio-theme.css` aplicam os estilos aos componentes da aplicação. O projeto incorpora os recursos locais necessários, sem instalar o pacote completo `@carbon/react`.

A fonte Montserrat é carregada dos arquivos normal e itálico em `frontend/public/fonts`. Sua licença SIL Open Font License 1.1 está em [OFL-Montserrat.txt](../../public/fonts/OFL-Montserrat.txt). Os binários da fonte não pertencem ao Carbon.

Ao atualizar esses recursos, preserve as licenças e verifique os dois cenários, a navegação por teclado e as telas estreitas.
