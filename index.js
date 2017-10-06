var express = require('express');
var expressNunjucks = require('express-nunjucks');
var app = express();
var chokidar = require('chokidar');
var Promise = require('bluebird');
var mkdir = Promise.promisify(require('fs').mkdir);
var readFile = Promise.promisify(require('fs').readFile);
var readdir = require('fs').readdir;
var fs = require('fs');
var path = require('path');
var shell = require('shelljs');
var cam = require("raspicam");
var uuid = require('uuid/v1');

app.set('views',  __dirname + '/templates');

app.use(express.static('public'));
app.use(express.static('pics'));
app.use(express.static('backgrounds'));

var njk = expressNunjucks(app, {
    watch: true,
    noCache: true
});
 
app.get('/', (req, res) => {
	
	startStreaming();
    res.render('index');
	
});

app.get('/pictures', (req, res) => {

	stopStreaming();
	var pics = fs.readdirSync("./pics").filter(function(file) {
		return file.includes(".") && !file.includes("DS");
	});
	
	res.render('pics', {
		pics: pics
	});
});	
	
app.get('/pictures/:pic', (req, res) => {

	var dir = "./pics/" + req.params.pic + "/";
	
	var pics = fs.readdirSync(dir).filter(function(file) {
		return file.includes(".") && !file.includes("DS") && !file.includes("output");
	});
	
	var backgrounds = fs.readdirSync("./backgrounds").filter(function(file) {
		return file.includes(".") && !file.includes("DS");
	});
	
	res.render('picture', {
		pics: pics,
		picture: req.params.pic,
		backgrounds: backgrounds
	});
	
});

app.get('/stream/start', (req, res) => {
    startStreaming();
	res.json();
});

app.get('/stream/stop', (req, res) => {
    stopStreaming();
	res.json();
});


app.get('/takePic', (req, res) => {
	var filename = uuid();
	var extension = ".jpg"
	var cmd = "wget http://localhost:8080/?action=snapshot -O " + __dirname + "/public/" + filename + extension;
	
	shell.exec(cmd, {silent: true}); // This can't be async.. otherwise the streaming stops and there's no image!
	
	// Process the image here
	var cmd = 'mogrify -modulate 200,300 ' + __dirname + "/public/" + filename + extension;
	shell.exec(cmd)
	stopStreaming();
	
	res.json({img : filename});
	
});

// These last two functions sure aren't safe... and it probably violates everything I've ever learned with programming,
// but this app won't be exposed outside the local environment.
app.get('/save/:pic', (req, res) => {
	console.log("Attempting to save temporary file.");
	shell.mv(__dirname + "/public/" + req.params.pic, __dirname + '/pics/');
	mkdir('./pics/' + req.params.pic).then(function(contents) {
		res.json();
	});
});

app.get('/delete/:pic', (req, res) => {
	console.log("Removing temporary file.");
	shell.exec("rm ./public/" + req.params.pic, {silent:true});
	startStreaming();
	res.json();
});

app.post('/process/:pic/:background', (req, res) => {
	var output = processFile(req.params.pic, req.params.background);
	res.json({output: output});
})

// This is where the magic happens. 
function processFile(file, backgroundImage) {
	console.log("Attempting to process!");
	var dir = "./pics/" + file;
	var originalPic = dir + ".jpg";
 	var background = "./backgrounds/" + backgroundImage;
	var rgbnum = "#44ff15"
	var output = dir + "/output.png";
	
	// convert the image and remove the background
	var cmd = 'convert ' + originalPic + ' -channel r -separate +channel -fuzz 8% -fill black -opaque black -fill white +opaque black ' + output;
	shell.exec(cmd);	

	var outputImage = uuid() + ".png";
	var outputPath = dir + "/" + outputImage;
	var background = "./backgrounds/" + backgroundImage;
	
	var cmd = 'convert '  + background + ' ' + originalPic + ' ' + output + ' -compose over -composite ' + outputPath;
	console.log("Processed!");
	shell.exec(cmd);
	
	return file + "/" + outputImage;
};


app.listen(3000, function() {
	console.log("Running!");
	startStreaming();
});

function startStreaming() {
  console.log("Attempting to start streaming");
  shell.exec("raspistill --nopreview -w 1920 -h 1080 -q 100 -o /tmp/stream/pic.jpg -tl 1 -t 9999999 -th 0:0:0 -br 60 &", {async:true, silent: true});
  console.log("raspistill started");
  shell.exec('LD_LIBRARY_PATH=/usr/local/lib mjpg_streamer -i "input_file.so -f /tmp/stream -n pic.jpg" -o "output_http.so -w /usr/local/www" &', {async:true, silent:true});
  console.log("mjpg_streamer started");

}

function stopStreaming() {
	// Kill the streamer to free up some processing power.
	shell.exec("pkill raspistill")
	shell.exec("pkill mjpg_streamer");
}
