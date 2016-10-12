const chalk = require('chalk');
const fs = require('fs-promise');
fs.access('./musiclist.json', fs.F_OK).catch((err) => {
	return fs.writeFile('./musiclist.json', '[]');
}).then(() => {
	return fs.readFile('./musiclist.json', 'utf8');
}).then((data) => {
	global.musicList = JSON.parse(data);
	require('./bot');
}).catch((err) => {
	console.error(chalk.bgRed('Error while starting...'));
	console.error(chalk.bgRed(err.stack));
});
