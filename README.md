# Marés — Porto (4410-463)

PWA minimalista que mostra **apenas** a maré para o código postal **4410-463**
(São Félix da Marinha, V. N. Gaia), usando como referência o **Porto de Leixões**.

Sem mapas, sem pesquisa de localização, sem outras estações — uma só vista:

- **Próxima maré** (preia-mar / baixa-mar) com hora e contagem decrescente
- **Curva da maré de hoje** com o "agora" marcado (sintetizada a partir dos extremos)
- **Lista das marés do dia** com alturas
- Funciona **offline** (instalável no telemóvel) e mostra os últimos dados guardados

## Dados

Os dados vêm da [TideCheck API](https://tidecheck.com/developers) (oficial,
inclui Leixões/Porto). É preciso uma **chave de API** (plano gratuito: 50 pedidos/dia).
A app pede a chave uma vez e guarda-a **apenas no teu telemóvel** (`localStorage`);
não há nenhuma chave no código.

A estação é resolvida automaticamente na 1ª utilização (procura `Leixões` via
`/api/stations/search`) e o ID fica guardado. A TideCheck devolve apenas as marés
alta/baixa; a curva do dia é interpolada no telemóvel (cosseno entre extremos).

> Nota: por ser uma PWA estática, a chave é usada diretamente no browser. Para uso
> pessoal não há problema. Se um dia quiseres escondê-la, mete um pequeno proxy
> (ex.: Cloudflare Worker) e aponta `API_BASE` em `app.js` para esse proxy.

## Como usar / instalar

1. Aloja a pasta num qualquer site estático com **HTTPS** (GitHub Pages, Netlify,
   Cloudflare Pages…). HTTPS é obrigatório para a PWA e o service worker.
2. Abre o site no telemóvel → **"Adicionar ao ecrã principal"**.
3. Na primeira abertura, cola a tua chave TideCheck (`tc_live_…`) e carrega em **Guardar**.

### Testar localmente

```bash
python3 -m http.server 8123
# abre http://127.0.0.1:8123
```

(O service worker exige `localhost` ou HTTPS — em `127.0.0.1` funciona na mesma.)

## Configuração

No topo do `app.js`:

```js
const STATION_QUERY = 'Leixões'; // estação de referência usada para o 4410-463
```

Se quiseres outra estação, muda o termo de procura (ou apaga `mares.station` no
`localStorage` para forçar nova resolução).

## Ficheiros

| Ficheiro | Função |
|---|---|
| `index.html` | Estrutura da página |
| `styles.css` | Estilo (tema escuro "oceano") |
| `app.js` | Lógica: fetch à API, render, cache, gestão da chave |
| `sw.js` | Service worker (cache do app shell / offline) |
| `manifest.webmanifest` | Metadados da PWA |
| `icons/` | Ícones gerados |
