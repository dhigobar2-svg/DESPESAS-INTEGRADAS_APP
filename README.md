# Painel de Gestão da Telemetria · Logon

**Arauco · Projeto Sucuriú**

Painel de análise de telemetria veicular a partir dos relatórios exportados do sistema Logon.
É um aplicativo **single-file** (`index.html`) em HTML + CSS + JavaScript puro, 100% client-side:
não há backend e os dados carregados nunca saem do navegador.

## Como usar

1. Abra o `index.html` em um navegador moderno (ou hospede em GitHub Pages / Netlify — é um site estático).
2. Arraste ou selecione os arquivos `.xlsx` exportados do Logon (um por veículo — a placa é
   extraída automaticamente do nome do arquivo, padrão Mercosul ou antigo).
3. Navegue pelos módulos, aplique filtros e exporte os resultados.

> As bibliotecas (ApexCharts, SheetJS, jsPDF, PptxGenJS) são carregadas via CDN,
> portanto é necessária conexão com a internet ao abrir o painel.

## Módulos

| Módulo | Descrição |
|---|---|
| **Visão Geral** | KPIs e gráficos consolidados da frota |
| **Velocidade** | Distribuição, picos e comportamento por condutor |
| **Leitura Inteligente** | Insights automáticos e evidências de violação |
| **Monitor de KM** | Controle de quilometragem mensal por veículo cadastrado |
| **Registros** | Base detalhada com busca, ordenação e paginação |
| **Limites & Config** | Cadastro de limites de velocidade por via (com tolerância) e de monitoramento de KM |

## Recursos

- **Filtros combinados**: período, faixa de horário, ignição, placas, condutores, vias e velocidade,
  além de **cross-filter** ao clicar nos gráficos (estilo Power BI).
- **Critério único de violação** usado em KPIs, tabelas, insights e exportações:
  registro em movimento acima do limite da via, com tolerância configurável (padrão 5 s)
  para descartar excursões comprovadamente curtas.
- **Exportações da aba atual ou do painel completo**: PDF, PowerPoint, Excel e
  **backup JSON** (dados, limites e cadastros — pode ser recarregado no painel para restaurar tudo).
- **Tema claro/escuro** com a paleta corporativa Arauco.
- Layout responsivo (sidebar recolhível em telas menores).

## Estrutura do repositório

```
index.html   # O painel completo (HTML + CSS + JS em um único arquivo)
README.md
```

O arquivo corresponde à versão **v10** do painel (`Painel_Telemetria_Logon_v10.html`).

## Tecnologias

- [ApexCharts](https://apexcharts.com/) — gráficos interativos
- [SheetJS (xlsx)](https://sheetjs.com/) — leitura das planilhas do Logon e exportação Excel
- [jsPDF](https://github.com/parallax/jsPDF) + [jspdf-autotable](https://github.com/simonbengtsson/jsPDF-AutoTable) — exportação PDF
- [PptxGenJS](https://gitbrent.github.io/PptxGenJS/) — exportação PowerPoint
