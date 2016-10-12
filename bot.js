const bodyParser = require('body-parser');
const chalk = require('chalk');
const cheerio = require('cheerio');
const express = require('express');
const fs = require('fs');
const http = require('http');
const logger = require('morgan');
const requestOptions = {
	'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/53.0.2785.143 Safari/537.36'
};
const request = require('request').defaults(requestOptions);
const rq = require('request-promise').defaults(requestOptions);

const {Html5Entities} = require('html-entities');
const entities = new Html5Entities();

const telegram = require('telegram-bot-api');

const config = require('./config/');

const _baseurl = 'https://api.telegram.org/bot' + config.token + '/';
const useCert = (process.env.CERT === 'true');
const useHook = (process.env.HOOK === 'true');

global.debug = (process.env.NODE_ENV || 'development') === 'development';

const saveMusicList = () => {
	fs.writeFile('./musiclist.json', JSON.stringify(musicList));
};

let userDB = {};
const handleHook = (update) => {
	if(update.callback_query) return handleCallback(update.callback_query);
	if(!update.message) return;
	if(update.message.text){
		update.message.text = update.message.text.slice(0, 128);
		if(update.message.text.startsWith('bs:')){
			let query = update.message.text.replace('bs:', '');
			rq({
				method: 'GET',
				uri: `http://bgmstore.net/search?q_type=title&q_mode=general&q=${encodeURIComponent(query)}`
			}).then((body) => {
				const $ = cheerio.load(body);
				const result = $('.searchResultWrap .title');
				const buttons = [];
				for(let i = 0; i < result.length; i++){
					let v = $(result[i]);

					let match = v.attr('href').match(/view\/([a-zA-Z0-9]+)/);
					if(match === null) continue;
					if(match[1] === undefined) continue;
					let title = entities.decode(v.html());
					buttons.push([{
						callback_data: 'bs:' + match[1],
						text: title
					}]);
				}
				return rq({
					method: 'POST',
					form: {
						chat_id: update.message.chat.id,
						text: '보내실 노래를 선택해주세요!',
						reply_markup: JSON.stringify({
							inline_keyboard: buttons.slice(0, 20)
						})
					},
					url: _baseurl + 'sendMessage'
				});
			}).catch((err) => {
				console.error(chalk.bgRed(err.stack));
				api.sendMessage({
					chat_id: update.message.chat.id,
					text: '죄송합니다! 오류가 생겼습니다!'
				});
			});
		}else if(update.message.text.startsWith('op:')){
			let query = update.message.text.replace('op:', '');
			rq({
				method: 'GET',
				uri: `http://bgm.khinenw.tk/search?q=${query}`,
				json: true
			}).then((data) => {
				if(typeof data === 'string') data = JSON.parse(data);
				return rq({
	                method: 'POST',
	                form: {
						chat_id: update.message.chat.id,
						text: '보내실 노래를 선택해주세요!',
						reply_markup: JSON.stringify({
							inline_keyboard: data.map((v) => {
								return [{
									callback_data: 'op:' + v.id,
									text: v.artist + ' - ' + v.title
								}];
							}).slice(0, 20)
						})
					},
	                url: _baseurl + 'sendMessage'
	            });
			}).catch((err) => {
				console.error(chalk.bgRed(err.stack));
				api.sendMessage({
					chat_id: update.message.chat.id,
					text: '죄송합니다! 오류가 생겼습니다!'
				});
			});
		}else{
			api.sendMessage({
				chat_id: update.message.chat.id,
				text: `사용법:
op:[검색할 대상] 으로 osu! 데이터베이스에서 검색,
bs:[검색할 대상]으로 bgmstore에서 검색,
파일을 올리면 포워딩 해드립니다.

채널 관리자: @Khinenw`
			});
		}
	}else if(update.message.audio){
		console.log(chalk.cyan(update.message.audio.file_id) + chalk.yellow(' redirected by ') + chalk.red(update.message.from.id));
		api.forwardMessage({
			chat_id: config.target,
			from_chat_id: update.message.chat.id,
			message_id: update.message.message_id,
			disable_notification: 'true'
		}).then(() => {
			api.sendMessage({
				chat_id: update.message.chat.id,
				text: '성공적으로 전달했습니다!'
			});
		});
	}
};

const handleCallback = (cq) => {
	if(typeof cq.data !== 'string') return;

	const sendMessage = (text) => {
		api.sendMessage({
			chat_id: cq.from.id,
			text
		});
	};

	if(userDB[cq.from.id] !== undefined && userDB[cq.from.id] > Date.now())
		return sendMessage(`현재 서버 측 과부하 때문에 30초에 한 번으로 보내는 것을 제한하고 있습니다.
직접 파일을 올려보시는 것은 어떤가요?`);

	userDB[cq.from.id] = Date.now() + 30 * 1000;
	console.log(chalk.cyan(cq.data) + chalk.yellow(' requested by ') + chalk.red(cq.from.id));

	api.answerCallbackQuery({
		callback_query_id: cq.inline_message_id
	}).catch((err) => {
		console.error(chalk.bgRed(err.stack));
	});

	if(musicList.indexOf(cq.data) !== -1){
		return sendMessage('이미 채널에 존재하는 음악입니다!');
	}

	if(cq.data.startsWith('bs:')){
		let data = cq.data.split(':');
		rq({
			method: 'GET',
			uri: `https://bgmstore.net/view/${data[1]}`
		}).then((html) => {
			const $ = cheerio.load(html);
			let text = $('.contentWrap .titleBox').contents().get(0).nodeValue.trim();
			let match = text.match(/^(?:\[[^]+\])?([^-]+) ?- ?([^()]+)(?:[ ]{1,5}([^]+))?$/);
			let [artist, title] = ['', text];
			if(match !== null) [artist, title] = [match[0], match[1]];

			return rq({
				method: 'POST',
				json: true,
				formData: {
					chat_id: config.target,
					audio: request(`https://dl.bgms.kr/download/${data[1]}/mp3/${encodeURIComponent(text)}`),
					title,
					performer: artist,
					disable_notification: 'true'
				},
				uri: _baseurl + 'sendAudio'
			});
		}).then(() => {
			sendMessage('성공적으로 전송했습니다!');
			musicList.push(cq.data);
			saveMusicList();
		}).catch((err) => {
			console.error(chalk.bgRed(err.stack));
			sendMessage('다운로드 중 에러가 발생했습니다! T_T');
		});
	}else if(cq.data.startsWith('op:')){
		let data = cq.data.replace('op:', '');
		let loadedData = undefined;
		sendMessage('osu! 데이터베이스에서 불러오는 것은 혀재 *상당히* 느립니다.\n느긋하게 다른 것을 하고 계시면 됩니다.');
		rq({
			method: 'GET',
			uri: `https://bgm.khinenw.tk/load/${data}`,
			json: true
		}).catch((err) => {
			return rq({
				method: 'GET',
				uri: `https://bgm.khinenw.tk/load/${data}`,
				json: true
			});
		}).then((loaded) => {
			loadedData = loaded;
			return rq({
				method: 'GET',
				uri: 'https://bloodcat.com/osu/',
				json: true,
				qs: {
					q: data,
					c: 's',
					mod: 'json'
				}
			});
		}).then((osuData) => {
			let informations = osuData[0];
			let [artist, title] = ['', data];
			if(informations !== undefined) [artist, title] = [informations.artistU, informations.titleU];
			return rq({
				method: 'POST',
				json: true,
				formData: {
					chat_id: config.target,
					title,
					performer: artist,
					audio: request(`https://bgm.khinenw.tk/${loadedData.audio}`),
					disable_notification: 'true'
				},
				uri: _baseurl + 'sendAudio'
			});
		}).then(() => {
			sendMessage('성공적으로 전송했습니다!');
			musicList.push(cq.data);
			saveMusicList();
		}).catch((err) => {
			console.error(chalk.bgRed(err.stack));
			sendMessage('다운로드 중 에러가 발생했습니다! T_T');
		});
	}
}

global.api = new telegram({
	token: config.token,
	updates: {
		enabled: !useHook
	}
});

if(useHook){
	const app = express();
	if(debug) app.use(logger('dev'));
	app.use(bodyParser.text({
		type: 'application/json'
	}));

	app.post('/' + hook, (req, res, next) => {
		const item = JSON.parse(req.body);
		handleHook(item);
		res.end(':D');
	});

	app.use((req, res, next) => {
		res.redirect('https://telegram.me/Submusicbot');
	});

	let httpServer;
	let options;

	if(useCert){
		options = {
			key: fs.readFileSync('/cert/key.pem'),
			crt: fs.readFileSync('/cert/crt.pem')
		};
	}

	const port = ((val) => {
		let portNumber = parseInt(val, 10);

		if(isNaN(portNumber)){
			return val;
		}

		if(portNumber >= 0){
			return portNumber;
		}

		return false;
	})(process.env.PORT || '443');

	app.set('port', port);

	if(useCert) httpServer = http.createServer(options, app);
	else httpServer = http.createServer(app);

	httpServer.listen(port);
	httpServer.on('error', (err) => {
		if(err.syscall !== 'listen') throw err;
		let bind = typeof port === 'string' ? 'Pipe ' + port : 'Port ' + port;

		switch(err.code){
			case 'EACCES':
				console.error(chalk.bgRed('권한이 없습니다!'));
				process.exit(1);
				return;

			case 'EADDRINUSE':
				console.error(chalk.bgRed('포트가 이미 점령당했습니다!'));
				process.exit(1);
				return;
		}

		throw error;
	});

	httpServer.on('listening', () => {
		let addr = httpServer.address();
		console.log(chalk.cyan((typeof addr === 'string') ? addr + '로 파이프 중...' : addr.port + '번 포트에서 듣는 중...'));
	});

	if(!useCert){
		rq({
			method: 'POST',
			json: true,
			formData: {
				url: config.hookUrl + hook
			},
			url: _baseurl + 'setWebhook'
		});
	}else api.setWebhook(config.hookUrl + hook, options.crt);
}else{
	api.on('update', handleHook)
}
