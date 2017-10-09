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
var bodyParser = require('body-parser');
var multer = require('multer'); // v1.0.5
var upload = multer(); // for parsing multipart/form-data

global.brightness = 0;
global.saturation = 0;
global.fuzz = 0;

app.set('views',  __dirname + '/templates');

app.use(bodyParser.json()); // for parsing application/json
app.use(bodyParser.urlencoded({ extended: true })); // for parsing application/x-www-form-urlencoded
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

app.get('/config', (req, res) => {
    stopStreaming();
	
	res.render('config', {
		fuzz: global.fuzz,
		saturation: global.saturation,
		brightness: global.brightness
	});
});

app.post('/config/test', upload.array(), (req,res) => {
	console.log("Running test configuration");
	
	var params = req.body;
	
	var testParams = {
		fuzz: params.fuzz,
		saturation: params.saturation,
		brightness: params.brightness
	}
	
	var file = "test-output.jpg";
	var dir = __dirname + "/public/";
	takePic(file);
	brightenPic(file, testParams.brightness, testParams.saturation);
	processMask(dir + file, dir +  file, testParams.fuzz);
	
	res.sendStatus(200);
});

app.post('/config/save', upload.array(), (req, res) => {
	
	var params = req.body;
	
	console.log("Saving settings");
	
	brightness= params.brightness;
	saturation = params.saturation;
	fuzz = params.fuzz;
	
	saveSettings(fuzz, brightness, saturation);
	res.sendStatus(200);
})
	

app.get('/takePic', (req, res) => {
	
	var filename = uuid();
	var extension = ".jpg"
	
	var file = filename + extension;
	var dir = __dirname + "/public/";
	var brightness = global.brightness;
	var saturation = global.saturation;
	var fuzz = global.fuzz;
	
	console.log("Processing with: fuzz(" + fuzz +"), saturation(" + saturation +"), brightness(" + brightness +")");
	
	takePic(file);
	brightenPic(file, brightness, saturation);
	
	stopStreaming();
	
	res.json({img : filename});
	
});

// These last two functions sure aren't safe... and it probably violates everything I've ever learned with programming,
// but this app won't be exposed outside the local environment.
app.get('/save/:pic', (req, res) => {
	console.log("Attempting to save temporary file.");
	shell.mv(__dirname + "/public/" + req.params.pic + ".jpg", __dirname + '/pics/');
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
	var output = processFile(req.params.pic, req.params.background, process.env['photo_fuzz']);
	res.json({output: output});
})

// This is where the magic happens. 
function processFile(file, backgroundImage, fuzz) {
	console.log("Attempting to process!");
	var dir = "./pics/" + file;
	var originalPic = dir + ".jpg";
 	var background = "./backgrounds/" + backgroundImage;
	var rgbnum = "#44ff15"
	var output = dir + "/output.png";
	
	processMask(originalPic, output, fuzz);

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
	loadSettings();
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
	console.log("Stopping streamer...");
	shell.exec("pkill raspistill")
	shell.exec("pkill mjpg_streamer");
}

function brightenPic(file, brightness, saturation) {
	// Process the image here
	var cmd = 'mogrify -modulate ' + (brightness || 0 )+',' + (saturation || 0) + ' ' + __dirname + "/public/" + file;
	shell.exec(cmd)
}

function processMask(pic, output, fuzz) {
	console.log(fuzz);
	// convert the image and remove the background
	var cmd = 'convert ' + pic + ' -channel r -separate +channel -fuzz ' + fuzz +'% -fill black -opaque black -fill white +opaque black ' + output;
	shell.exec(cmd);	
}

function takePic(file) {
	console.log("Taking pic: " + file);
	if (process.env.photo_debug) {
		shell.cp('-R', './sample.jpg', './public/' + file);
	} else {
		var cmd = "wget http://localhost:8080/?action=snapshot -O " + __dirname + "/public/" + file;
		shell.exec(cmd); // This can't be async.. otherwise the streaming stops and there's no image!
	}
}

function saveSettings(fuzz, brightness, saturation) {
	var settings = fuzz + "," + brightness + "," + saturation
	shell.rm("./settings.txt");
	fs.writeFile("./settings.txt", settings , function(err) {
		if(err) {
			return console.log(err);
		}

		console.log("Settings Saved!");
	}); 
}

// This should probably be in a database, but It's going on a RPI and I don't want anything chewing up processing. 
function loadSettings() {
	fs.readFile("./settings.txt", 'utf8', function(err, data) {
	 	console.log("Settings loaded!");
		var settings = data.split(",");
		global.fuzz = settings[0];
		global.brightness = settings[1];
		global.saturation = settings[2];
	});
}
