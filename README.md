# quadro-ar

Um quadro impresso que ganha vida pela câmera do celular. A pessoa aponta o celular para o
quadro, um vídeo anima por cima da impressão e um botão de play, preso a um ponto do quadro,
toca uma música com a letra em karaokê. Tudo roda no navegador, sem aplicativo: o MindAR
reconhece a imagem e o three.js desenha por cima dela.

**Estado:** protótipo funcionando com arquivos provisórios no lugar do vídeo, da música e da
letra. O reconhecimento do quadro foi confirmado num celular real, apontado para a imagem
aberta na tela de um computador. Todo o resto (música, letra, perda de rastreamento) só foi
verificado de ponta a ponta em Chrome para computador, com uma câmera simulada. Nada foi
testado com o quadro impresso.

## Rodar

Não precisa de `npm install`: o site é só arquivos estáticos. Requer Node 22 ou mais novo.

```
npm start        # inicia o servidor em http://localhost:8080
```

O `npm start` só inicia o servidor; ele não abre o navegador. Deixe esse terminal aberto
enquanto usar o site, porque fechando-o o endereço deixa de responder. Só então abra
http://localhost:8080. Se aparecer "already in use", o servidor já está rodando em outra
janela.

Neste computador o navegador pede a webcam. Aponte ela para a imagem aberta em outra tela,
ou para uma impressão.

`npm run setup` só é preciso para refazer a pasta `vendor/`, por exemplo ao trocar a versão do
three.js ou do MindAR no `package.json`.

### Testar num celular

A câmera só abre por HTTPS. Há dois caminhos:

1. **Publicar** o site (ver abaixo) e abrir o endereço no celular.
2. **Android, só para teste rápido:** rode `node tools/serve.mjs 8080 --lan`, que mostra os
   endereços para outros aparelhos na mesma rede. No Chrome do celular, abra
   `chrome://flags/#unsafely-treat-insecure-origin-as-secure`, adicione o endereço
   `http://IP-DO-COMPUTADOR:8080`, ative e reinicie o navegador. Se essa opção não existir na
   versão instalada, use o caminho 1. No iPhone não há equivalente.

### Ajustar sem publicar de novo

Acrescente `?debug` ao endereço para ver um painel com o estado e para testar valores pela
URL antes de gravá-los no `src/config.js`:

```
/?debug&mask=assets/animation-mask.sample.png&miss=12&u=0.5&v=0.2
```

| Parâmetro | equivale a |
|---|---|
| `video`, `mask`, `music`, `lyrics` | `animation.src`, `animation.mask`, `music.src`, `music.lyrics` (`none` desliga a máscara) |
| `fade`, `loop`, `feather` | `animation.fade`, `animation.loopPause`, `animation.feather` |
| `offset` | `music.offsetMs` |
| `u`, `v` | `playButton.u`, `playButton.v` |
| `warmup`, `miss`, `cutoff`, `beta` | os quatro valores de `tracking` |

## Trocar os arquivos provisórios

| Arquivo | O que é | Requisitos |
|---|---|---|
| `assets/target.mind` | Dados com que o MindAR reconhece o quadro | Gere a partir do arquivo que foi de fato impresso: troque `assets/target-source.jpg` e rode `npm run compile` |
| `assets/animation.mp4` | Vídeo desenhado sobre o quadro | Primeiro quadro idêntico à imagem impressa; mesma proporção (3:4); H.264 em MP4, de 720p a 1080p; sem áudio |
| `assets/animation-mask.png` | Máscara opcional: branco mostra o vídeo, preto deixa a impressão real aparecer | Mesma proporção do vídeo. Ative em `animation.mask` |
| `assets/music.mp3` | A música | MP3 |
| `assets/lyrics.lrc` | A letra com marcações de tempo | Formato LRC; aceita tempo por palavra |
| `assets/thumb.jpg` | Miniatura da tela inicial | 270 × 360 |

O vídeo só aparece enquanto toca; entre um loop e outro a pessoa vê a impressão real. Por
isso o primeiro quadro deve ser a própria imagem: a entrada vira um aflorar suave e não um
salto. Se o final for parecido com o começo, o loop fica contínuo.

Sobre a máscara: se o vídeo gerado tiver as partes paradas idênticas à impressão, dá para
usá-lo sem máscara, cobrindo o quadro inteiro. Com máscara, a impressão real aparece nas
partes paradas, mas qualquer erro de posicionamento do rastreamento aparece como uma leve
dobra nas bordas da máscara. Vale testar os dois no celular.

Formato da letra:

```
[ti:Nome da música]
[00:12.30][00:12.30]Primeira [00:12.80]linha
[00:15.00]Próxima linha, só com o tempo inicial
```

A segunda linha do exemplo não tem tempo por palavra: as palavras são distribuídas ao longo
de uma estimativa de quanto tempo a linha leva para ser cantada.

Os textos da tela inicial estão em `index.html`.

## Ajustes em `src/config.js`

| Chave | Efeito |
|---|---|
| `animation.fade` | Segundos para o vídeo aparecer e para dar lugar ao quadro |
| `animation.loopPause` | Segundos com o quadro parado antes de o vídeo tocar de novo |
| `animation.feather` | 0 a 0.1: suaviza a borda do vídeo sobre o quadro, com um pouco de fantasma |
| `playButton.u`, `playButton.v` | Onde o botão de play fica no quadro, de 0 a 1 a partir da esquerda e de cima |
| `music.offsetMs` | Adianta (negativo) ou atrasa (positivo) a letra em relação à música |
| `tracking.missTolerance` | Quantos quadros de perda o MindAR tolera antes de esconder a animação |
| `tracking.filterBeta`, `tracking.filterMinCF` | Mais suavidade e menos tremor, em troca de um pequeno atraso no movimento |

## Publicar

O que vai para o ar é só a pasta `dist/`, criada por `npm run build`: as páginas, o código, os
arquivos e as bibliotecas. Ficam de fora as ferramentas, os testes e a imagem-mestre do alvo.
O build para com erro se algum arquivo que a página precisa estiver faltando, e
`npm run test:dist` roda o teste de ponta a ponta contra essa pasta, como ela será publicada.

O site funciona tanto num endereço próprio quanto numa subpasta (como
`usuario.github.io/repositorio/`), porque todos os caminhos são relativos.

### GitHub Pages (atualiza com `npm run deploy`)

O projeto está publicado em https://xohps.github.io/quadro-ar/. No plano gratuito o
repositório precisa ser público.

O branch `main` guarda o código. O branch `gh-pages` guarda só a pasta `dist/` e é o que o
GitHub Pages serve. `npm run deploy` refaz a pasta e envia esse branch, sem tocar no `main`.
Para guardar as mudanças no código, faça o commit e o `git push` como de costume.

Depois de uma atualização, o GitHub Pages pode seguir entregando a versão anterior por até
10 minutos. Para testar no celular sem esperar, abra o site numa aba privada.

### Outra hospedagem (Vercel, Cloudflare Pages, Netlify)

Todas têm plano gratuito com HTTPS. Rode `npm run build` e envie a pasta `dist/`: pelo painel,
arrastando a pasta, ou pela ferramenta de linha de comando do serviço. A cada mudança, repita
o comando e o envio.

### Depois de publicar

- Gere o QR code só então, apontando para o endereço definitivo.
- Se a imagem impressa mudar, rode `npm run compile` e publique de novo.
- O site pede aos buscadores que não o indexem (`robots.txt` e uma meta tag), mas o endereço
  é público: qualquer pessoa com o link abre.
- Um QR code impresso dura tanto quanto o endereço por trás dele. Se isso preocupa, um
  domínio próprio (pago) permite trocar de hospedagem mais tarde sem trocar o QR code.

## Testes

```
npm test
```

Roda dois níveis:

- **Unitários** (rápidos, sem navegador): o parser de letra, o servidor estático e o build
  da pasta `dist/`.
- **Ponta a ponta** (`tools/e2e.mjs`): abre o site num Chrome sem janela, com uma câmera
  simulada mostrando a imagem pendurada numa parede. São quatro cenários: tela deitada,
  tela em pé, o quadro saindo da câmera e voltando, e animação com máscara. Verifica onde a
  animação cai, o botão de play, a música, a letra e a pausa. Precisa do Chrome ou do Edge e
  do ffmpeg. `--headed` mostra a janela e `--shots <pasta>` guarda capturas de tela.

`npm run test:dist` roda o mesmo teste de ponta a ponta contra a pasta `dist/` pronta para
publicar, servida de uma subpasta.

O teste de ponta a ponta usa condições ideais: imagem chapada, nítida e bem iluminada. Ele
não substitui o teste com o quadro impresso e um celular de verdade.

## Limitações e o que falta testar

- **Celulares.** O reconhecimento do quadro foi visto funcionar num celular real; não sei
  qual modelo nem qual sistema. Música, letra e perda de rastreamento não foram experimentados
  num celular. O site usa recursos que exigem Safari 16.4 ou mais novo; não sei dizer até que
  versão do Chrome para Android ele funciona.
- **Navegador aberto dentro de outro app** (câmera do WhatsApp, do Instagram): a câmera pode
  ser bloqueada. O site mostra uma orientação de como abrir no navegador, mas isso não foi
  testado.
- **O MindAR só procura a imagem no centro da tela.** O meio do celular precisa estar sobre
  a parte com detalhes do quadro. Se a pessoa apontar para a moldura ou para a parede, o
  quadro não é reconhecido.
- **Mais de um celular ao mesmo tempo:** cada um rastreia sozinho e toca a música no próprio
  alto-falante, sem sincronia.
- **Celular antigo ou básico** pode ficar travado: o rastreamento é pesado.
- **Impressão:** vidro ou acrílico na frente do quadro causa reflexo e faz o rastreamento se
  perder. Prefira acabamento fosco.
- **Música gravada por outra pessoa:** publicar o arquivo num endereço público é,
  tecnicamente, distribuição sem autorização.

Notas técnicas:

- O three.js está fixado na 0.160.0 de propósito. O build do MindAR 1.2.5 usa `sRGBEncoding`,
  que o three.js removeu na 0.162.0.
- O console mostra um aviso do three.js sobre `outputEncoding`. É inofensivo.
- `npm install` relata falhas em dependências de desenvolvimento (o pacote `tar`, puxado pelo
  MindAR). Elas não entram no site publicado.

## Estrutura

```
index.html          página e textos da tela inicial
robots.txt          pede aos buscadores que não indexem o site
src/config.js       todos os ajustes
src/main.js         tela inicial, carregamento, erros de câmera, botão de play, música
src/ar.js           ponte com o MindAR
src/overlay.js      o plano de vídeo sobre o quadro
src/lyrics.js       parser de LRC e cálculo de tempo (sem DOM, testado no Node)
src/karaoke.js      a folha de letra
src/style.css
assets/             alvo, vídeo, música, letra, miniatura
vendor/             three.js e MindAR, copiados por tools/vendor.mjs
dist/               o site pronto para publicar, criado por npm run build
tools/              servidor, build, publicação, compilador do alvo, gerador dos provisórios, testes
test/               testes unitários
```

Os arquivos provisórios foram gerados por
`python tools/make-placeholders.py <imagem> [--force]`. O script nunca sobrescreve um arquivo
existente sem `--force`, para não apagar os arquivos reais.
