<?php

header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

header('Content-Type: application/json; charset=utf-8');
ini_set('display_errors', '0');

// JSON на любые необработанные исключения
set_exception_handler(function (Throwable $e) {
    http_response_code(502);
    echo json_encode(['error' => 'exception', 'message' => $e->getMessage()], JSON_UNESCAPED_UNICODE);
});

// JSON на фаталы/таймауты (вместо HTML)
register_shutdown_function(function () {
    $e = error_get_last();
    if ($e && (stripos($e['message'] ?? '', 'Maximum execution time') !== false || $e['type'] === E_ERROR)) {
        http_response_code(504);
        echo json_encode(['error' => 'timeout', 'message' => 'Upstream took too long'], JSON_UNESCAPED_UNICODE);
    }
});


if ($_SERVER['REQUEST_METHOD'] == 'OPTIONS') {
    http_response_code(200);
    exit();
}

$service = new service('lBYFH953RqTyIub4ZsrMjVBZbcWgoJrE',
 '5K4vYnHlnxwEnqO1yOgeY52PG0mTQkjA');
$service->process($_GET, file_get_contents('php://input'));

class service
{
    /**
     * @var string Auth login
     */
    private $login;
    /**
     * @var string Auth pwd
     */
    private $secret;
    /**
     * @var string Base Url for API 2.0 Production
     */
    private $baseUrl;
    /**
     * @var string Auth Token
     */
    private $authToken;
    /**
     * @var array Data From Request
     */
    private $requestData;
    /** @var array Request metrics */
    private $metrics;

    public function __construct($login, $secret, $baseUrl = 'https://api.cdek.ru/v2')
    {
        $this->login = $login;
        $this->secret = $secret;
        $this->baseUrl = $baseUrl;
        $this->metrics = array();
    }

    public function process($requestData, $body)
    {
        $time = $this->startMetrics();
        $this->requestData = array_merge($requestData, json_decode($body, true) ?: array());

        if (!isset($this->requestData['action'])) {
            $this->sendValidationError('Action is required');
        }

        try {
            $this->getAuthToken();

            switch ($this->requestData['action']) {
                case 'offices':
                    $this->sendResponse($this->getOffices(), $time);
                    break;
                case 'calculate':
                    $this->sendResponse($this->calculate(), $time);
                    break;
                default:
                    $this->sendValidationError('Unknown action');
            }
        } catch (Throwable $e) {
            $this->http_response_code(502);
            header('Content-Type: application/json');
            echo json_encode(['error' => 'service_failed', 'message' => $e->getMessage()], JSON_UNESCAPED_UNICODE);
            exit();
        }
    }

    private function sendValidationError($message)
    {
        $this->http_response_code(400);
        header('Content-Type: application/json');
        header('X-Service-Version: 3.11.1');
        echo json_encode(array('message' => $message));
        exit();
    }

    private function http_response_code($code)
    {
        switch ($code) {
            case 100:
                $text = 'Continue';
                break;
            case 101:
                $text = 'Switching Protocols';
                break;
            case 200:
                $text = 'OK';
                break;
            case 201:
                $text = 'Created';
                break;
            case 202:
                $text = 'Accepted';
                break;
            case 203:
                $text = 'Non-Authoritative Information';
                break;
            case 204:
                $text = 'No Content';
                break;
            case 205:
                $text = 'Reset Content';
                break;
            case 206:
                $text = 'Partial Content';
                break;
            case 300:
                $text = 'Multiple Choices';
                break;
            case 301:
                $text = 'Moved Permanently';
                break;
            case 302:
                $text = 'Moved Temporarily';
                break;
            case 303:
                $text = 'See Other';
                break;
            case 304:
                $text = 'Not Modified';
                break;
            case 305:
                $text = 'Use Proxy';
                break;
            case 400:
                $text = 'Bad Request';
                break;
            case 401:
                $text = 'Unauthorized';
                break;
            case 402:
                $text = 'Payment Required';
                break;
            case 403:
                $text = 'Forbidden';
                break;
            case 404:
                $text = 'Not Found';
                break;
            case 405:
                $text = 'Method Not Allowed';
                break;
            case 406:
                $text = 'Not Acceptable';
                break;
            case 407:
                $text = 'Proxy Authentication Required';
                break;
            case 408:
                $text = 'Request Time-out';
                break;
            case 409:
                $text = 'Conflict';
                break;
            case 410:
                $text = 'Gone';
                break;
            case 411:
                $text = 'Length Required';
                break;
            case 412:
                $text = 'Precondition Failed';
                break;
            case 413:
                $text = 'Request Entity Too Large';
                break;
            case 414:
                $text = 'Request-URI Too Large';
                break;
            case 415:
                $text = 'Unsupported Media Type';
                break;
            case 500:
                $text = 'Internal Server Error';
                break;
            case 501:
                $text = 'Not Implemented';
                break;
            case 502:
                $text = 'Bad Gateway';
                break;
            case 503:
                $text = 'Service Unavailable';
                break;
            case 504:
                $text = 'Gateway Time-out';
                break;
            case 505:
                $text = 'HTTP Version not supported';
                break;
            default:
                exit('Unknown http status code "' . htmlentities($code) . '"');
        }

        $protocol = (isset($_SERVER['SERVER_PROTOCOL']) ? $_SERVER['SERVER_PROTOCOL'] : 'HTTP/1.0');
        header($protocol . ' ' . $code . ' ' . $text);
        $GLOBALS['http_response_code'] = $code;
    }

    private function getAuthToken()
    {
        $time = $this->startMetrics();

        $token = $this->httpRequest('oauth/token', array(
            'grant_type' => 'client_credentials',
            'client_id' => $this->login,
            'client_secret' => $this->secret,
        ), true);

        $this->endMetrics('auth', 'Server Auth Time', $time);

        $result = json_decode($token['result'], true);

        if (!isset($result['access_token'])) {
            throw new RuntimeException('Server not authorized to CDEK API');
        }

        $this->authToken = $result['access_token'];
    }

    private function startMetrics()
    {
        return function_exists('hrtime') ? hrtime(true) : microtime(true);
    }

    private function httpRequest($method, $data, $useFormData = false, $useJson = false)
    {
        $ch = curl_init("$this->baseUrl/$method");

        $headers = array(
            'Accept: application/json',
            'X-App-Name: widget_pvz',
            'X-App-Version: 3.11.1'
        );
        if ($this->authToken) {
            $headers[] = "Authorization: Bearer $this->authToken";
        }

        if ($useFormData) {
            curl_setopt_array($ch, array(
                CURLOPT_POST => true,
                CURLOPT_POSTFIELDS => $data,
            ));
        } elseif ($useJson) {
            $headers[] = 'Content-Type: application/json';
            curl_setopt_array($ch, array(
                CURLOPT_POST => true,
                CURLOPT_POSTFIELDS => json_encode($data, JSON_UNESCAPED_UNICODE),
            ));
        } else {
            curl_setopt($ch, CURLOPT_URL, "$this->baseUrl/$method?" . http_build_query($data));
        }

        curl_setopt_array($ch, array(
            CURLOPT_USERAGENT      => 'widget/3.11.1',
            CURLOPT_HTTPHEADER     => $headers,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HEADER         => true,

            // 🔴 ключевые параметры
            CURLOPT_CONNECTTIMEOUT => 5,   // ждать коннект не дольше 5с
            CURLOPT_TIMEOUT        => 12,  // общий таймаут запроса < 30с php
            CURLOPT_IPRESOLVE      => CURL_IPRESOLVE_V4, // обойти глюки с IPv6/DNS
            CURLOPT_ENCODING       => '',  // принимать gzip/deflate
            CURLOPT_HTTP_VERSION   => CURL_HTTP_VERSION_1_1,
            CURLOPT_FAILONERROR    => false, // сами обработаем код
        ));

        $response   = curl_exec($ch);
        $errno      = curl_errno($ch);
        $err        = curl_error($ch);
        $status     = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $headerSize = curl_getinfo($ch, CURLINFO_HEADER_SIZE);
        curl_close($ch);

        if ($response === false || $errno) {
            throw new RuntimeException("curl($method) failed: $err", $errno ?: 500);
        }

        $headersStr = substr($response, 0, $headerSize);
        $result     = substr($response, $headerSize);

        // Если апстрим вернул не-JSON (например, HTML-страницу ошибки) — не пускаем это дальше
        $decoded = json_decode($result, true);
        if ($decoded === null) {
            throw new RuntimeException("Upstream returned non-JSON for $method (HTTP $status)");
        }

        // Пробрасываем полезную мета-инфу
        $addedHeaders = $this->getHeaderValue($headersStr);
        return array('result' => json_encode($decoded, JSON_UNESCAPED_UNICODE), 'addedHeaders' => $addedHeaders);
    }

    private function getHeaderValue($headers)
    {
        $headerLines = explode("\r\n", $headers);
        return array_filter($headerLines, static function ($line) {
            return !empty($line) && stripos($line, 'X-') !== false;
        });
    }

    private function endMetrics($metricName, $metricDescription, $start)
    {
        $this->metrics[] = array(
            'name' => $metricName,
            'description' => $metricDescription,
            'time' => round(function_exists('hrtime') ? (hrtime(true) - $start) / 1e+6 : (microtime(true) - $start) * 1000,
                2),
        );
    }

    private function sendResponse($data, $start)
    {
        $this->http_response_code(200);
        header('Content-Type: application/json');
        header('X-Service-Version: 3.11.1');
        if (!empty($data['addedHeaders'])) {
            foreach ($data['addedHeaders'] as $header) {
                header($header);
            }
        }

        $this->endMetrics('total', 'Total Time', $start);

        if (!empty($this->metrics)) {
            header('Server-Timing: ' . array_reduce($this->metrics, function ($c, $i) {
                    return $c . $i['name'] . ';desc="' . $i['description'] . '";dur=' . $i['time'] . ',';
                }, ''));
        }

        echo $data['result'];

        exit();
    }

    protected function getOffices()
    {
        $time = $this->startMetrics();

        // Значения по умолчанию, если виджет не прислал фильтры
        if (empty($this->requestData['type'])) {
            $this->requestData['type'] = 'PVZ'; // только пункты выдачи, без постаматов
        }
        if (empty($this->requestData['country_code'])) {
            $this->requestData['country_code'] = 'RU';
        }
        // Явно русскую локаль, чтобы не тянуть лишнее
        if (empty($this->requestData['lang'])) {
            $this->requestData['lang'] = 'rus';
        }

        $result = $this->httpRequest('deliverypoints', $this->requestData);
        $this->endMetrics('office', 'Offices Request', $time);
        return $result;
    }

    protected function calculate()
    {
        $time = $this->startMetrics();
        $result = $this->httpRequest('calculator/tarifflist', $this->requestData, false, true);

        $this->endMetrics('calc', 'Calculate Request', $time);
        return $result;
    }
}