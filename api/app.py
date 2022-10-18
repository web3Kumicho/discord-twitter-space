import requests
import tweepy
import os

from dotenv import load_dotenv

from flask import Flask, request, Response, send_file, jsonify, make_response
from flask_cors import CORS, cross_origin
from pymongo import MongoClient
from io import BytesIO

from PIL import Image, ImageDraw, ImageFont
from urllib.parse import parse_qsl
from json import dumps, JSONDecodeError
from eth_utils.address import is_address, to_checksum_address

load_dotenv()

app = Flask(__name__)
app.config['DISCORD_CLIENT_ID'] = os.environ['DISCORD_CLIENT_ID']
app.config['DISCORD_CLIENT_SECRET'] = os.environ['DISCORD_CLIENT_SECRET']
app.config['DISCORD_BOT_TOKEN'] = os.environ['DISCORD_BOT_TOKEN']
app.config['DISCORD_GUILD_ID'] = os.environ['DISCORD_GUILD_ID']
app.config['DISCORD_ROLE_ID'] = os.environ['DISCORD_ROLE_ID']
app.config['TWITTER_API_KEY'] = os.environ['TWITTER_API_KEY']
app.config['TWITTER_API_SECRET'] = os.environ['TWITTER_API_SECRET']
app.config['TWITTER_BEARER_TOKEN'] = os.environ['TWITTER_BEARER_TOKEN']
app.config['MONGO_URI'] = os.environ['MONGO_URI']
CORS(app)

client = MongoClient(app.config['MONGO_URI'])
members = client['allowlist']['members']

# Function used to return Flask `Response` objects.
def bad_response(message):
    return Response(
        dumps({"error": message}),
        status=400, mimetype='application/json'
    )

# Handles Discord OAuth2 Redirect.
@app.route('/oauth2/discord/redirect', methods=['GET'])
def oauth2_discord_redirect():

    # Confirm that the request has been made with `code` query param.
    if 'code' not in request.args:
        return Response(
            dumps({"error": "Bad request."}),
            status=400, mimetype='application/json'
        )

    # Construct form to be sent in `access_token` request.
    form = {
        'client_id': app.config['DISCORD_CLIENT_ID'],
        'client_secret': app.config['DISCORD_CLIENT_SECRET'],
        'grant_type': 'authorization_code',
        'code': request.args['code'],
        'redirect_uri': 'http://localhost:5000/oauth2/discord/redirect'
    }

    # Make request to Discord API to retrieve `access_token`.
    try:
        res = requests.post(
            'https://discord.com/api/oauth2/token',
            headers={'Content-Type': 'application/x-www-form-urlencoded'}, data=form
        )
    except:
        return Response(
            dumps({"error": "Failed Discord OAuth2 Request."}),
            status=400, mimetype='application/json'
        )

    # If unexpected response from Discord API.
    if res.status_code != 200:
        return Response(
            dumps({"error": "Bad Discord OAuth2 Response."}),
            status=400, mimetype='application/json'
        )

    # Return `access_token`.
    return jsonify({
        "access_token": res.json()['access_token']
    })

# Returns Twitter Access Token.
@app.route('/oauth1/twitter/token', methods=['GET'])
def oauth1_twitter_token():

    # Create Tweepy `OAuth1UserHandler` instance.
    twitter = tweepy.OAuth1UserHandler(
        app.config['TWITTER_API_KEY'],
        app.config['TWITTER_API_SECRET']
    )

    # Get Twitter Authorization URL.
    try:
        auth_url = twitter.get_authorization_url()
    except:
        return bad_response("Failed Twitter Authentication Request.")

    # Return Twitter Authentication URL.
    return Response(
        dumps({"auth_url": auth_url.replace('authorize', 'authenticate')}),
        headers={
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Credentials": True
        }
    )

# Handles Verification of Discord & Twitter Auth Tokens.
@app.route('/oauth/verify', methods=['POST'])
@cross_origin()
def oauth_verify():

    # Assign JSON Payload to `payload`.
    payload = request.json

    # Confirm payload is valid.
    if not all(key in payload for key in ('discordCode', 'twitterToken', 'twitterVerifier')):
        return bad_response("Invalid payload.")

    # Construct form to be sent in `access_token` request.
    # TODO: Change `redirect_uri` in production.
    form = {
        'client_id': app.config['DISCORD_CLIENT_ID'],
        'client_secret': app.config['DISCORD_CLIENT_SECRET'],
        'grant_type': 'authorization_code',
        'code': payload['discordCode'],
        'redirect_uri': 'http://localhost:5173/'
    }

    # Make request to Discord API to retrieve `access_token`.
    try:
        res = requests.post(
            'https://discord.com/api/oauth2/token',
            headers={'Content-Type': 'application/x-www-form-urlencoded'}, data=form
        )
    except:
        return bad_response("Failed Discord OAuth2 Request.")

    # Validate status code from previous request.
    if res.status_code != 200:
        return bad_response("Bad Discord OAuth2 Response.")

    # Determine if `access_token` is in response.
    if 'access_token' not in res.text:
        return bad_response("Invalid Discord OAuth2 Response.")

    try:
        oauth2_res = res.json()
    except JSONDecodeError:
        return bad_response("Malformed Discord OAuth2 Response.")

    # Define `access_token`.
    access_token = oauth2_res['access_token']

    # Define `discord_token`.
    discord_token = oauth2_res['refresh_token']

    # Consume `access_token` and perform Discord user lookup.
    try:
        res = requests.get(
            'https://discord.com/api/users/@me',
            headers={
                'Authorization': f'Bearer {access_token}',
                'accept': 'application/x-www-form-urlencoded'
            }
        )
    except:
        return bad_response("Failed Discord Lookup Request.")

    # Validate status code from previous request.
    if res.status_code != 200:
        return bad_response("Bad Discord Lookup Response.")

    # Parse Discord user lookup response.
    try:
        discord_lookup = res.json()
    except JSONDecodeError:
        return bad_response("Malformed Discord Lookup Response.")

    # Define `discord_id`.
    discord_id = discord_lookup['id']

    # Define `discord_username`.
    discord_username = f"{discord_lookup['username']}#{discord_lookup['discriminator']}"

    # Consume `twitterToken` and `twitterVerifier` to acquire an access token.
    try:
        res = requests.post(
            'https://api.twitter.com/oauth/access_token',
            params={
                'oauth_token': payload['twitterToken'],
                'oauth_verifier': payload['twitterVerifier']
            }
        )
    except:
        return bad_response("Failed Twitter Access Request.")

    # Validate status code from previous request.
    if res.status_code != 200:
        return bad_response("Bad Twitter Access Response.")

    # Parse Twitter user lookup response.
    twitter_response = dict(parse_qsl(res.text))

    # Define `twitter_id`.
    twitter_id = twitter_response['user_id']

    # Define `twitter_username`.
    twitter_username = twitter_response['screen_name']

    # Define query for database lookup.
    query = {
        "$or": [
            {"twitter": twitter_username},
            {"discord": discord_username}
        ]
    }

    # Query database for WL'd member.
    member = members.find_one(query)

    # TODO: Handle more than 1 result found.

    # If user is not found in the database.
    if member is None:
        return jsonify({
            "success": False,
            "message": "User is not allowlisted."
        })
    
    # If user has already submitted a wallet.
    if member['address'] != "":
        return jsonify({
            "success": False,
            "message": "User has already submitted a wallet address."
        })

    # Update database with relevant information IF whitelisted.
    members.update_one({'_id': member['_id']}, {
        "$set": {
            "discord": discord_username,
            "discord_id": discord_id,
            "twitter": twitter_username,
            "twitter_id": twitter_id
        }
    })

    # Return user profile response.
    return jsonify({
        "success": True,
        "discord": {
            "refresh_token": discord_token,
            "username": discord_username
        },
        "twitter": {
            "username": twitter_username,
            "id": twitter_id
        }
    })

# Handles Database Updating.
@app.route('/submit', methods=['POST'])
@cross_origin()
def submit():

    # Parse `request` payload as JSON.
    payload = request.json

    # Confirm payload is valid.
    if not all(key in payload for key in ('discordRefresh', 'twitterId', 'walletAddress')):
        return bad_response("Invalid payload.")

    # Validate `walletAddress`.
    if not is_address(payload['walletAddress']):
        return jsonify({
            "success": False,
            "message": f"{payload['walletAddress']} is not a valid Ethereum address."
        })

    # Request another access token to verify Discord OAuth.
    form = {
        'client_id': app.config['DISCORD_CLIENT_ID'],
        'client_secret': app.config['DISCORD_CLIENT_SECRET'],
        'grant_type': 'refresh_token',
        'refresh_token': payload['discordRefresh']
    }

    # Make request to Discord API to retrieve updated `access_token`.
    try:
        res = requests.post(
            'https://discord.com/api/oauth2/token',
            headers={'Content-Type': 'application/x-www-form-urlencoded'}, data=form
        )
    except:
        return bad_response("Failed Discord OAuth2 Request.")

    if res.status_code != 200:
        return bad_response("Bad Discord OAuth2 Response.")

    if 'access_token' not in res.text:
        return bad_response("Invalid Discord OAuth2 Response.")

    try:
        oauth2_res = res.json()
    except JSONDecodeError:
        return bad_response("Malformed Discord OAuth2 Response.")

    try:
        access_token = oauth2_res['access_token']
    except KeyError:
        return bad_response("Unable to parse access token.")

    # Consume `access_token` and perform Discord user lookup.
    try:
        res = requests.get(
            'https://discord.com/api/users/@me',
            headers={
                'Authorization': f'Bearer {access_token}',
                'accept': 'application/x-www-form-urlencoded'
            }
        )
    except:
        return bad_response("Failed Discord Lookup Request.")

    if res.status_code != 200:
        return bad_response("Bad Discord Lookup Response.")

    try:
        discord_lookup = res.json()
    except JSONDecodeError:
        return bad_response("Malformed Discord Lookup Response.")

    # Define `discord_id`.
    discord_id = discord_lookup['id']

    # Define `discord_username`.
    discord_username = f"{discord_lookup['username']}#{discord_lookup['discriminator']}"

    # Query database.
    member = members.find_one({
        'twitter_id': payload['twitterId']
    })

    # If user is not found in the database.
    if member is None:
        return bad_response("Don't try to be sneaky.")

    # Validate Discord information.
    if discord_id != member['discord_id'] or discord_username != member['discord']:
        return bad_response("User information mismatch.")

    # Get Twitter screen name.
    try:
        res = requests.get(
            f'https://api.twitter.com/2/users/{payload["twitterId"]}',
            headers={'Authorization': f'Bearer {app.config["TWITTER_BEARER_TOKEN"]}'}
        )
    except:
        return bad_response("Failed Twitter Lookup Request.")

    # Parse Twitter lookup response.
    twitter_user = res.json()

    # Validate Twitter information.
    if twitter_user['data']['username'] != member['twitter']:
        return bad_response("User information mismatch.")

    # Update database entry with `walletAddress`.
    members.update_one({'_id': member['_id']}, {
        "$set": {
            "address": to_checksum_address(payload['walletAddress'])
        }
    })

    # Grant user `Boarding Pass` role.
    try:
        res = requests.put(
            f'https://discord.com/api/v9/guilds/{app.config["DISCORD_GUILD_ID"]}/members/{member["discord_id"]}/roles/{app.config["DISCORD_ROLE_ID"]}',
            headers={
                'Content-Type': 'application/json',
                'Authorization': f'Bot {app.config["DISCORD_BOT_TOKEN"]}'
            }
        )
    except:
        return bad_response("Failed Role Allocation.")

    return jsonify({
        "success": True,
        "message": "Address has been submitted."
    })

# Generates and downloads a Boarding Pass.
@app.route('/claim', methods=['GET'])
def claim():

    if 'username' not in request.args:
        return bad_response("Invalid request.")

    username = request.args['username']

    # Confirm that user is in database.
    member = members.find_one({
        'twitter': username
    })

    # Confirm that a `member` has been found.
    if member is None:
        return bad_response("User is not allowlisted.")

    # Make request to Twitter API to get PFP.
    response = requests.get(
        f'https://api.twitter.com/2/users/by/username/{username}?user.fields=profile_image_url',
        headers={'Authorization': f'Bearer {app.config["TWITTER_BEARER_TOKEN"]}'}
    )

    # Assign `image_url` URL of PFP and resize to keep image quality high.
    image_url = response.json()['data']['profile_image_url'].replace('normal', '400x400')

    # Get PFP from Twitter.
    image_response = requests.get(image_url)

    # Convert `image_response.content` to PIL object.
    twitter_image = Image.open(BytesIO(image_response.content)).convert('RGBA')

    # Define base image.
    base_image = Image.open('./base.png').convert('RGBA')

    # Layer Twitter PFP on to base image.
    base_image.alpha_composite(twitter_image, (570, 400))

    # Layer `template.png` on top of base image.
    if member['project'] == "udo":
        base_image.alpha_composite(
            Image.open(f'./templates/{member["project"]}.png').convert('RGBA')
        )
    else:
        base_image.alpha_composite(
            Image.open('./templates/default.png').convert('RGBA')
        )

    # Make image writable.
    d1 = ImageDraw.Draw(base_image)

    # Font selection from the downloaded file
    user_font = ImageFont.truetype('./fixedsys-excelsior-301.ttf', 48)

    # Create username is respective font.
    d1.text((965, 470), username.upper(), fill=(255, 255, 255), font=user_font)

    # Convert image to bytes.
    image_bytes = BytesIO()

    # Save the image to `image_bytes`.
    base_image.save(image_bytes, 'PNG')

    # Reset file position offset to 0.
    image_bytes.seek(0)
    
    # Create a Flask repsonse object.
    resp = make_response(send_file(image_bytes, mimetype='image/png'))
    resp.headers['Content-Disposition'] = f'attachment; filename="BP_{username}.png"'

    return resp

# This route is the first request made upon the user connecting their
# wallet on the Boarding Pass checker page. A return value of `true`
# indicates that the user is on the allowlist AND has a fully populated
# schema.
@app.route('/allowlisted/<address>', methods=['GET'])
def allowlisted(address):

    # Validate the provided `address` value is a valid Ethereum address.
    if not is_address(address):
        return jsonify({
            "success": False,
            "message": f'{address} is not a valid Ethereum address.'
        })
    
    # Query the database using the formatted checksum value of `address`.
    member = members.find_one({
        'address': to_checksum_address(address)
    })

    # If a query via `address` yields no results, we assume that `address`
    # is not allowlisted.
    if member is None:
        return jsonify({
            "success": False,
            "message": "Address is not allowlisted."
        })
    
    # If a result is found, validate that the schema is fully populated.
    if member['twitter_id'] == "" or member['discord_id'] == "":
        return jsonify({
            "success": False,
            "message": "Profile not populated."
        })

    # If the schema is fully populated, return `true`.
    return jsonify({
        "success": True,
        "username": member['twitter']
    })

if __name__ == '__main__':
    app.run(debug=True, port=1337)
