# Dev Quest - jogo para feira de profissões

A **tela grande** (notebook/TV) mostra o jogo. O **celular do visitante** vira o controle: ele escaneia o QR code e joga.
Cada sessão tem um código próprio (ex.: `K7M2`) e aceita **um único celular**. Ao terminar (ou após 90s parado), o QR muda para a próxima pessoa.

## Rodar

Dê dois cliques em `iniciar.bat` (ou `npm install` uma vez e depois `npm start`) e deixe a janela aberta.
O navegador abre em `http://localhost:8787`. Aperte `F` para tela cheia.

Na primeira vez o Windows pergunta sobre o Firewall: marque **Redes privadas** e permita.

## Como o celular chega no jogo (escolha uma)

1. **Hotspot do notebook (recomendado):** Windows > Configurações > Rede > *Ponto de acesso móvel*. Ligue, e coloque o nome/senha num cartaz ao lado do QR. Não depende do Wi-Fi da feira, mas o Windows costuma só ligar o hotspot se o notebook estiver conectado a alguma rede (mesmo sem internet). Teste antes. Se não ligar, conecte o notebook a um roteador Wi-Fi pequeno, usado só para o jogo, e coloque o nome e a senha dele no cartaz.
   Os celulares precisam conectar nesse Wi-Fi antes de escanear.
2. **Wi-Fi da feira:** funciona se o notebook e os celulares estiverem na mesma rede e ela não isolar os aparelhos (muitas redes públicas isolam).
3. **Internet (celular no 4G/5G):** exponha a porta com um túnel (ex.: `cloudflared tunnel --url http://localhost:8787`) e inicie com a URL pública:
   `set PUBLIC_URL=https://xxxx.trycloudflare.com && npm start`

### Instalar o cloudflared (só para a opção 3, celular no 4G/5G)

O `cloudflared` é o programa gratuito da Cloudflare que cria o endereço público. Não precisa de conta. Instale **uma vez**, com internet, antes da feira:

1. Abra o **PowerShell** (menu Iniciar > digite `PowerShell`) e rode:
   `winget install --id Cloudflare.cloudflared --source winget`
2. Se o Windows pedir, aceite os termos (digite `S` ou `Y` e Enter).
3. **Feche e abra o PowerShell de novo** e confira com `cloudflared --version`. Se aparecer um número de versão, está instalado.
4. Se o `winget` não existir no seu Windows, baixe o instalador `cloudflared-windows-amd64.msi` em https://github.com/cloudflare/cloudflared/releases/latest e dê dois cliques.

Depois é só dar dois cliques em `iniciar-tunel.bat`: ele abre o túnel, descobre o endereço público e já inicia o jogo com esse endereço dentro do QR code. Deixe a janela aberta durante a feira. O endereço `trycloudflare.com` muda a cada vez que você liga, então **não imprima o QR code**: use sempre o que aparece na tela.

Se o servidor escolher o IP errado (aparece mais de uma rede), veja o endereço impresso no terminal e use `set PUBLIC_URL=http://IP:8787`.

## Publicar na internet

O jogo precisa de um servidor Node com WebSocket (é ele que liga a tela grande ao celular), então **não funciona só como site estático** (Cloudflare Pages, GitHub Pages, Netlify). Opções:

- **Túnel Cloudflare (mais simples):** o jogo continua rodando no notebook e o `cloudflared` cria um endereço público. Veja a opção 3 acima. Não custa nada e não muda código.
- **Hospedar o servidor Node como está:** Render, Railway ou Fly.io. Comando de start `npm start`; eles definem `PORT` sozinhos. Defina `PUBLIC_URL` com o endereço final do site.
- **Cloudflare Workers + Durable Objects:** dá para portar, mas o `server.js` precisa ser reescrito (cada sala vira um Durable Object).

Para a feira, prefira o hotspot do notebook: não depende da internet do local e tem menos atraso no controle.

## Personalizar

- Textos do curso, instituição, contato e link: bloco `CONFIG` no topo do `<script>` de `public/index.html`. **Troque os textos de exemplo** (instituição, duração, contato) antes da feira: o console do navegador avisa se sobrou algum.
- Perguntas e perfis: `QUIZ` e `PROFILES` no mesmo arquivo.
- Tela do celular: `public/pad.html`.

## Modos e dificuldade

- **1 jogador ou Duelo:** depois de escanear o QR, o celular mostra o menu. No **duelo**, o segundo jogador escaneia o mesmo QR (que continua ativo) e os dois jogam na mesma tela, cada um no seu celular: na Fase 1 quem tocar primeiro no bug leva os pontos; na Fase 2 cada um monta o seu próprio ciclo, no seu celular, com **1 minuto** de relógio e pontuação separada (a fase fecha sozinha quando o tempo acaba ou os dois terminam, e a tela de resultado só avança quando os dois tocam em "Pronto", ou após 20s); na Fase 3 cada um responde o seu quiz e recebe o seu perfil. No fim, a tela mostra quem venceu e cada celular mostra o seu resultado. O operador também pode escolher o modo pelos botões na tela grande.
- **Dificuldade (Normal ou Difícil 🔥):** escolhida no menu do celular ou na tela inicial. No Difícil os bugs aparecem mais rápido e somem antes, há mais 💡 features, a Fase 1 dura 30s, a Fase 2 tem 8 etapas e **embaralha as cartas quando você erra**.
- **Fases:** 1 Caça aos Bugs (com o 🦟 bug veloz, que vale mais), 2 Ciclo de vida e 3 Quiz de perfil.

## O que o jogo tem

- **Fase 1 espelhada:** o celular mostra 🐞/💡 dentro dos 9 botões, nos mesmos quadrantes da tela grande.
- **Modo atração:** com ninguém jogando, a tela inicial mostra uma demo animada, o QR e o ranking de hoje.
- **Som:** efeitos e trilha gerados no navegador. O navegador só libera o áudio depois de **um clique** na tela grande (aparece um aviso até lá). `M` liga/desliga o som.
- **Contagem 3-2-1** antes de cada fase, partículas, combo e confete no resultado.
- **Cartão de perfil:** no celular, botão "Salvar meu cartão" gera uma imagem para stories (compartilhar ou baixar; ou segurar a imagem para salvar).
- **Sem coleta de dados pessoais:** o jogo não pede nome real, telefone nem e-mail. Só guarda o apelido e a pontuação do ranking e contagens anônimas das partidas.
- **Fila de espera:** quem escaneia com a sessão ocupada entra na fila (com apelido). Quando liberar, o celular dele recebe a nova sala sozinho, com 30s de prioridade. A tela grande mostra "Fila: N · próximo: nome".
- **Ranking:** aparece na tela grande, com abas "Hoje" e "Geral". Uma cópia fica no servidor (`data/ranking.json`) para o painel do organizador mostrar o mesmo placar, mesmo em outro navegador.

## Painel do organizador

Abra `http://localhost:8787/admin.html` **no próprio notebook**: partidas por hora, perfis mais comuns, pontuação e tempo médios, modos jogados e o **ranking** (top 20). O botão **🗑 Zerar dados** apaga o ranking e as estatísticas (também esvazia o ranking na tela grande), ótimo para fazer testes antes de abrir ao público.
Para abrir de outro aparelho, inicie com uma senha: `set ADMIN_PASS=segredo && npm start`.
Os dados ficam na pasta `data/` (`partidas.json`, `ranking.json`). Apague a pasta, ou use o botão Zerar, para recomeçar do zero.

## Sem celular?

Se alguém não puder usar o QR, o botão **Jogar nesta tela** deixa jogar com toque/mouse na própria tela grande.
